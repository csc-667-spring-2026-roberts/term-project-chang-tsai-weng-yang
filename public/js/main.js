"use strict";
(() => {
  // src/client/main.ts
  var state = {
    authenticated: false,
    user: null
  };
  var listeners = /* @__PURE__ */ new Set();
  var RECONNECT_BASE_MS = 1e3;
  var RECONNECT_MAX_MS = 1e4;
  function setSessionState(next) {
    state.authenticated = next.authenticated;
    state.user = next.user;
    for (const listener of listeners) {
      listener({ ...state });
    }
  }
  function subscribeSession(listener) {
    listeners.add(listener);
    listener({ ...state });
    return () => {
      listeners.delete(listener);
    };
  }
  function renderSessionBanner(current) {
    const template = document.querySelector("#session-banner-tpl");
    const container = document.querySelector("#session-banner");
    if (!template || !container) {
      return;
    }
    const clone = template.content.cloneNode(true);
    const statusEl = clone.querySelector("[data-status]");
    const emailEl = clone.querySelector("[data-email]");
    if (statusEl) {
      statusEl.textContent = current.authenticated ? "Logged in" : "Guest";
      statusEl.className = current.authenticated ? "session-dot online" : "session-dot offline";
    }
    if (emailEl) {
      emailEl.textContent = current.authenticated && current.user ? current.user.email : "";
    }
    container.replaceChildren(clone);
  }
  async function loadInitialSession() {
    const response = await fetch("/auth/session", { credentials: "same-origin" });
    const data = await response.json();
    setSessionState({
      authenticated: data.authenticated,
      user: data.user ?? null
    });
  }
  function connectSessionStream() {
    let source = null;
    let retries = 0;
    let reconnectTimer = null;
    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };
    const scheduleReconnect = () => {
      clearReconnectTimer();
      retries += 1;
      const waitMs = Math.min(RECONNECT_BASE_MS * 2 ** (retries - 1), RECONNECT_MAX_MS);
      reconnectTimer = window.setTimeout(() => {
        open();
      }, waitMs);
    };
    const open = () => {
      clearReconnectTimer();
      if (source) {
        source.close();
      }
      source = new EventSource("/api/sse");
      source.addEventListener("connected", () => {
        retries = 0;
      });
      source.addEventListener("session:update", (event) => {
        const parsed = JSON.parse(event.data);
        setSessionState({
          authenticated: parsed.authenticated,
          user: parsed.user ?? null
        });
      });
      source.onerror = () => {
        if (source) {
          source.close();
        }
        scheduleReconnect();
      };
    };
    open();
  }
  document.addEventListener("DOMContentLoaded", () => {
    subscribeSession((current) => {
      renderSessionBanner(current);
    });
    void loadInitialSession().catch(() => {
      setSessionState({ authenticated: false, user: null });
    });
    connectSessionStream();
  });
})();
