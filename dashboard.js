const money = n => `KES ${Number(n || 0).toLocaleString("en-KE",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function load() {
  try {
    const me = await api("/api/auth/me");
    document.querySelector("#welcome").textContent = `Good to see you, ${me.user.full_name.split(" ")[0]} 👋`;

    const portfolio = await api("/api/portfolio");
    document.querySelector("#balance").textContent = money(portfolio.balance);
    document.querySelector("#holdingCount").textContent = portfolio.holdings.length;
    document.querySelector("#txCount").textContent = portfolio.transactions.length;

    const holdings = document.querySelector("#holdings");
    if (portfolio.holdings.length) {
      holdings.innerHTML = portfolio.holdings.map(h =>
        `<div class="row"><div><b>${escapeHtml(h.asset_name)}</b><small>${escapeHtml(h.asset_code)}</small></div><strong>${Number(h.quantity).toLocaleString()}</strong></div>`
      ).join("");
    }

    const list = document.querySelector("#transactionsList");
    list.innerHTML = portfolio.transactions.length
      ? portfolio.transactions.map(t => `<div class="row"><div><b>${escapeHtml(t.description || t.type)}</b><small>${new Date(t.created_at).toLocaleString()}</small></div><span class="badge ${t.status.toLowerCase()}">${t.status}</span><strong>${money(t.amount)}</strong></div>`).join("")
      : `<div class="empty">No transactions yet.</div>`;
  } catch (error) {
    if (error.message.includes("Authentication")) window.location.href = "/login.html";
    else document.body.insertAdjacentHTML("afterbegin", `<div class="top-error">${escapeHtml(error.message)}</div>`);
  }
}

document.querySelector("#depositForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.querySelector("#depositMessage");
  message.textContent = "Requesting STK Push…";
  message.className = "message";
  try {
    const body = Object.fromEntries(new FormData(event.target).entries());
    const result = await api("/api/payments/stk", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    message.textContent = `${result.message} Reference: ${result.reference}`;
    message.className = "message success";
    setTimeout(load, 2500);
  } catch (error) {
    message.textContent = error.message;
    message.className = "message error";
  }
});

document.querySelector("#logout")?.addEventListener("click", async () => {
  await fetch("/api/auth/logout", {method:"POST"});
  window.location.href = "/login.html";
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

load();