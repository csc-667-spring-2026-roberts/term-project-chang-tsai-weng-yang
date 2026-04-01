"use strict";
(() => {
  // src/client/main.ts
  async function renderSessionBanner() {
    const template = document.querySelector("#session-banner-tpl");
    const container = document.querySelector("#session-banner");
    if (!template || !container) return;
    try {
      const res = await fetch("/auth/session", { credentials: "same-origin" });
      const data = await res.json();
      const clone = template.content.cloneNode(true);
      const statusEl = clone.querySelector("[data-status]");
      const emailEl = clone.querySelector("[data-email]");
      if (statusEl) {
        statusEl.textContent = data.authenticated ? "Logged in" : "Guest";
        statusEl.className = data.authenticated ? "session-dot online" : "session-dot offline";
      }
      if (emailEl) {
        emailEl.textContent = data.authenticated && data.user ? data.user.email : "";
      }
      container.replaceChildren(clone);
    } catch {
      container.textContent = "";
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    void renderSessionBanner();
  });
})();
