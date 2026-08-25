const form = document.querySelector("form");
const message = document.querySelector("#message");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "Please wait…";
  const data = Object.fromEntries(new FormData(form).entries());

  if (form.id === "registerForm") {
    delete data.agree;
  }

  try {
    const response = await fetch(
      form.id === "registerForm" ? "/api/auth/register" : "/api/auth/login",
      {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data)
      }
    );

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Request failed");

    window.location.href = "/dashboard.html";
  } catch (error) {
    message.textContent = error.message;
    message.className = "message error";
  }
});