require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { z } = require("zod");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("JWT_SECRET is required.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const authSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().regex(/^(?:254|\+254|0)?7\d{8}$/),
  password: z.string().min(8).max(72)
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(72)
});

const amountSchema = z.object({
  amount: z.coerce.number().finite().min(10).max(1000000),
  phone: z.string().trim().regex(/^(?:254|\+254|0)?7\d{8}$/)
});

function normalizePhone(value) {
  const v = String(value).replace(/\s+/g, "");
  if (v.startsWith("+254")) return v.slice(1);
  if (v.startsWith("254")) return v;
  if (v.startsWith("07")) return "254" + v.slice(1);
  if (v.startsWith("7")) return "254" + v;
  throw new Error("Invalid Kenyan mobile number");
}

function signUser(user) {
  return jwt.sign(
    { sub: String(user.id), email: user.email },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
}

function setAuthCookie(res, token) {
  res.cookie("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 2 * 60 * 60 * 1000,
    path: "/"
  });
}

function requireAuth(req, res, next) {
  try {
    const token = req.cookies.session;
    if (!token) return res.status(401).json({ error: "Authentication required" });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired" });
  }
}

async function audit(userId, action, req, metadata = {}) {
  await pool.query(
    "INSERT INTO audit_log(user_id, action, ip_address, metadata) VALUES($1,$2,$3,$4)",
    [userId || null, action, req.ip || null, JSON.stringify(metadata)]
  );
}

async function darajaToken() {
  const env = process.env.DARAJA_ENV === "production" ? "production" : "sandbox";
  const base = env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

  const credentials = Buffer.from(
    `${process.env.DARAJA_CONSUMER_KEY}:${process.env.DARAJA_CONSUMER_SECRET}`
  ).toString("base64");

  const response = await fetch(
    `${base}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${credentials}` }
    }
  );

  if (!response.ok) {
    throw new Error(`Daraja OAuth failed: ${response.status}`);
  }

  const data = await response.json();
  return { token: data.access_token, base };
}

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function startStkPush({ phone, amount, accountReference }) {
  if (process.env.ENABLE_PAYMENTS !== "true") {
    throw new Error("Payments are disabled until an authorized Daraja configuration is enabled.");
  }

  const required = [
    "DARAJA_CONSUMER_KEY",
    "DARAJA_CONSUMER_SECRET",
    "DARAJA_SHORTCODE",
    "DARAJA_PASSKEY",
    "DARAJA_CALLBACK_URL"
  ];

  for (const key of required) {
    if (!process.env[key]) throw new Error(`${key} is not configured`);
  }

  const { token, base } = await darajaToken();
  const time = timestamp();

  const password = Buffer.from(
    `${process.env.DARAJA_SHORTCODE}${process.env.DARAJA_PASSKEY}${time}`
  ).toString("base64");

  const body = {
    BusinessShortCode: Number(process.env.DARAJA_SHORTCODE),
    Password: password,
    Timestamp: time,
    TransactionType: process.env.DARAJA_TRANSACTION_TYPE || "CustomerPayBillOnline",
    Amount: Math.round(amount),
    PartyA: normalizePhone(phone),
    PartyB: Number(process.env.DARAJA_SHORTCODE),
    PhoneNumber: normalizePhone(phone),
    CallBackURL: process.env.DARAJA_CALLBACK_URL,
    AccountReference: accountReference,
    TransactionDesc: "Investment account deposit"
  };

  const response = await fetch(
    `${base}/mpesa/stkpush/v1/processrequest`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!response.ok || data.ResponseCode !== "0") {
    throw new Error(data.errorMessage || data.ResponseDescription || "Daraja STK request failed");
  }

  return data;
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected", paymentsEnabled: process.env.ENABLE_PAYMENTS === "true" });
  } catch {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const input = authSchema.parse(req.body);
    const email = input.email.toLowerCase();
    const phone = normalizePhone(input.phone);

    const exists = await pool.query(
      "SELECT id FROM users WHERE email=$1 OR phone=$2 LIMIT 1",
      [email, phone]
    );

    if (exists.rowCount) {
      return res.status(409).json({ error: "An account already exists with that email or phone." });
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    const result = await pool.query(
      `INSERT INTO users(full_name,email,phone,password_hash)
       VALUES($1,$2,$3,$4)
       RETURNING id,full_name,email,phone,created_at`,
      [input.fullName, email, phone, passwordHash]
    );

    const user = result.rows[0];
    setAuthCookie(res, signUser(user));
    await audit(user.id, "ACCOUNT_CREATED", req);

    res.status(201).json({ user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Please provide valid registration details." });
    }
    console.error(error);
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const input = loginSchema.parse(req.body);
    const result = await pool.query(
      "SELECT * FROM users WHERE email=$1 LIMIT 1",
      [input.email.toLowerCase()]
    );

    if (!result.rowCount) return res.status(401).json({ error: "Invalid email or password." });

    const user = result.rows[0];
    const valid = await bcrypt.compare(input.password, user.password_hash);

    if (!valid) return res.status(401).json({ error: "Invalid email or password." });

    setAuthCookie(res, signUser(user));
    await audit(user.id, "LOGIN", req);

    res.json({
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone
      }
    });
  } catch {
    res.status(400).json({ error: "Invalid login details." });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("session", { httpOnly: true, sameSite: "lax", path: "/" });
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const result = await pool.query(
    "SELECT id,full_name,email,phone,created_at FROM users WHERE id=$1",
    [req.user.sub]
  );
  if (!result.rowCount) return res.status(401).json({ error: "Account not found." });
  res.json({ user: result.rows[0] });
});

app.get("/api/portfolio", requireAuth, async (req, res) => {
  const transactions = await pool.query(
    `SELECT id,type,status,amount,currency,provider,provider_reference,description,created_at,completed_at
     FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [req.user.sub]
  );

  const completed = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN type='DEPOSIT' AND status='COMPLETED' THEN amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN type='WITHDRAWAL' AND status='COMPLETED' THEN amount ELSE 0 END),0) AS balance
     FROM transactions WHERE user_id=$1`,
    [req.user.sub]
  );

  const holdings = await pool.query(
    `SELECT asset_code,asset_name,quantity,average_cost,currency
     FROM holdings WHERE user_id=$1 ORDER BY asset_name`,
    [req.user.sub]
  );

  res.json({
    balance: Number(completed.rows[0].balance || 0),
    holdings: holdings.rows,
    transactions: transactions.rows
  });
});

app.post("/api/payments/stk", requireAuth, async (req, res) => {
  try {
    const input = amountSchema.parse(req.body);
    const phone = normalizePhone(input.phone);
    const externalReference = `INV-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

    const pending = await pool.query(
      `INSERT INTO transactions(user_id,type,status,amount,currency,provider,description)
       VALUES($1,'DEPOSIT','PENDING',$2,'KES','MPESA','Pending investment account deposit')
       RETURNING id`,
      [req.user.sub, input.amount]
    );

    const stk = await startStkPush({
      phone,
      amount: input.amount,
      accountReference: externalReference
    });

    await pool.query(
      `UPDATE transactions
       SET provider_reference=$1,checkout_request_id=$2,description=$3
       WHERE id=$4`,
      [
        stk.MerchantRequestID || externalReference,
        stk.CheckoutRequestID || null,
        `M-PESA deposit request ${externalReference}`
      ]
    );

    await audit(req.user.sub, "STK_PUSH_REQUESTED", req, {
      amount: input.amount,
      reference: externalReference
    });

    res.json({
      ok: true,
      message: "STK Push requested. Complete it on the phone before the transaction is credited.",
      reference: externalReference,
      checkoutRequestId: stk.CheckoutRequestID
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || "Unable to start payment." });
  }
});

app.post("/api/mpesa/callback", async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return res.json({ ResultCode: 0, ResultDesc: "Accepted" });

    const checkoutId = callback.CheckoutRequestID;
    const resultCode = Number(callback.ResultCode);

    const existing = await pool.query(
      "SELECT * FROM transactions WHERE checkout_request_id=$1 LIMIT 1",
      [checkoutId]
    );

    if (!existing.rowCount) {
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const tx = existing.rows[0];

    if (resultCode === 0) {
      const metadata = Object.fromEntries(
        (callback.CallbackMetadata?.Item || []).map(item => [item.Name, item.Value])
      );

      const receipt = metadata.MpesaReceiptNumber || null;

      await pool.query(
        `UPDATE transactions
         SET status='COMPLETED',provider_reference=$1,completed_at=NOW(),
             description=$2
         WHERE id=$3 AND status='PENDING'`,
        [
          receipt || tx.provider_reference,
          `M-PESA deposit confirmed${receipt ? ` • Receipt ${receipt}` : ""}`,
          tx.id
        ]
      );

      await audit(tx.user_id, "MPESA_DEPOSIT_CONFIRMED", req, {
        transactionId: tx.id,
        receipt
      });
    } else {
      await pool.query(
        `UPDATE transactions SET status='FAILED',completed_at=NOW(),
         description=$1 WHERE id=$2 AND status='PENDING'`,
        [`M-PESA payment failed: ${callback.ResultDesc || "Unknown result"}`, tx.id]
      );

      await audit(tx.user_id, "MPESA_DEPOSIT_FAILED", req, {
        transactionId: tx.id,
        resultCode,
        resultDesc: callback.ResultDesc
      });
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error("Callback error:", error);
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`Investor workspace listening on port ${PORT}`);
});