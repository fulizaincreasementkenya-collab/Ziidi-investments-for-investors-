# ZIIDI INVESTOR WORKSPACE

Independent investment-management software foundation for Kenya.

## What this project is

This is a production-oriented starting point for an investment account interface. It includes:

- responsive landing page
- registration and login
- PostgreSQL persistence
- secure HTTP-only JWT session cookie
- transaction ledger
- portfolio endpoint
- audit logging
- optional server-side M-PESA Daraja STK Push integration
- callback reconciliation
- Render deployment configuration

## What this project is NOT

It is not automatically an official Safaricom/Ziidi service and it does not grant access to Ziidi customer accounts.

Do not market it as an official Safaricom or Ziidi website without written authorization.

A successful M-PESA payment is not, by itself, proof that a customer has purchased units in an investment fund. The investment/fund provider must be the authoritative source for units, NAV, withdrawals, statements and ownership.

## Run locally

Requirements:

- Node.js 20+
- PostgreSQL

1. Create a PostgreSQL database.
2. Run `schema.sql` against it.
3. Copy `.env.example` to `.env`.
4. Set `DATABASE_URL` and a strong `JWT_SECRET`.
5. Install packages:

```bash
npm install
```

6. Start:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Render

1. Push this repository to GitHub.
2. Create a PostgreSQL database with your chosen PostgreSQL provider.
3. Create a Render Web Service from the GitHub repository.
4. Render can use `render.yaml`.
5. Add `DATABASE_URL`.
6. Set `APP_BASE_URL` to your HTTPS Render URL.
7. Keep `ENABLE_PAYMENTS=false` until your authorized Daraja account and collection configuration are ready.
8. Run `schema.sql` once against the production database.

## M-PESA/Daraja

The integration is deliberately disabled by default.

When you have an authorized Daraja merchant account and have configured the appropriate API permissions, set:

- `ENABLE_PAYMENTS=true`
- `DARAJA_ENV=sandbox` for testing or `production` for approved production credentials
- `DARAJA_CONSUMER_KEY`
- `DARAJA_CONSUMER_SECRET`
- `DARAJA_SHORTCODE`
- `DARAJA_PASSKEY`
- `DARAJA_CALLBACK_URL`

The callback must be publicly reachable over HTTPS in production.

The application creates a PENDING transaction before requesting STK Push and only changes it to COMPLETED after a successful callback.

## Next production requirements

For an actual investment business, add the appropriate:

- licensed fund/investment-provider integration
- KYC and AML workflow
- suitability/risk disclosures
- identity verification
- MFA/passkeys
- rate limiting and bot protection
- CSRF strategy for state-changing browser operations
- encryption/key management
- withdrawal controls and approval workflow
- reconciliation against the authoritative provider ledger
- statements and tax reporting
- data-retention/deletion controls
- privacy notice and consent records
- incident response and monitoring
- regulator/provider-specific compliance

Do not invent portfolio values, returns, NAVs, market prices or transaction confirmations. Connect those values to authoritative sources.

## Official integration references

Safaricom's Daraja developer portal:
https://developer.safaricom.co.ke/

Safaricom's published Ziidi terms:
https://www.safaricom.co.ke/images/Downloads/M-PESA-Ziidi-Final-Terms-and-Conditions.pdf
