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
  var demoSource = null;
  function appendDemoLog(text, kind = "info") {
    const logEl = document.querySelector("#sse-message-log");
    if (!logEl) return;
    logEl.querySelector(".sse-placeholder")?.remove();
    const line = document.createElement("div");
    line.className = `sse-log-line sse-log-${kind}`;
    line.textContent = `${(/* @__PURE__ */ new Date()).toLocaleTimeString()}  ${text}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function renderRoomBadges(rooms) {
    const badgesEl = document.querySelector("#sse-room-badges");
    if (!badgesEl) return;
    badgesEl.innerHTML = "";
    for (const room of rooms) {
      const badge = document.createElement("span");
      badge.className = "sse-badge";
      badge.textContent = room;
      badgesEl.appendChild(badge);
    }
  }
  function setConnectBtnState(label, disabled) {
    const btn = document.querySelector("#sse-room-connect");
    if (!btn) return;
    btn.textContent = label;
    btn.disabled = disabled;
  }
  function connectDemoStream(channels) {
    demoSource?.close();
    setConnectBtnState("Connecting\u2026", true);
    const source = new EventSource(`/api/sse?channels=${encodeURIComponent(channels)}`);
    demoSource = source;
    source.addEventListener("connected", (ev) => {
      const payload = JSON.parse(ev.data);
      renderRoomBadges(payload.rooms);
      appendDemoLog(`Connected \xB7 rooms: [${payload.rooms.join(", ")}]`);
      setConnectBtnState("Reconnect", false);
    });
    source.addEventListener("demo:update", (ev) => {
      const payload = JSON.parse(ev.data);
      appendDemoLog(`demo:update  \u2192  ${payload.message ?? ev.data}`, "event");
    });
    source.onerror = () => {
      appendDemoLog("Connection lost \u2014 reconnecting\u2026", "error");
      setConnectBtnState("Reconnect", false);
    };
  }
  async function sendDemoBroadcast(rooms, message) {
    try {
      const res = await fetch("/api/events/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rooms, event: "demo:update", data: { message } })
      });
      const body = await res.json();
      appendDemoLog(`Sent to [${rooms.join(", ")}] \u2192 delivered to ${String(body.delivered)} subscriber(s)`);
    } catch {
      appendDemoLog("Broadcast failed", "error");
    }
  }
  function initSseDemoPanel() {
    const roomInput = document.querySelector("#sse-room-input");
    const connectBtn = document.querySelector("#sse-room-connect");
    const broadcastRoomsInput = document.querySelector("#sse-broadcast-rooms");
    const broadcastMsgInput = document.querySelector("#sse-broadcast-msg");
    const broadcastSendBtn = document.querySelector("#sse-broadcast-send");
    if (!roomInput || !connectBtn || !broadcastRoomsInput || !broadcastMsgInput || !broadcastSendBtn) {
      return;
    }
    connectBtn.addEventListener("click", () => {
      connectDemoStream(roomInput.value.trim() || "global");
    });
    broadcastSendBtn.addEventListener("click", () => {
      const rooms = broadcastRoomsInput.value.split(",").map((r) => r.trim()).filter(Boolean);
      const message = broadcastMsgInput.value.trim() || "Hello!";
      void sendDemoBroadcast(rooms, message);
    });
    connectDemoStream("global");
  }
  document.addEventListener("DOMContentLoaded", () => {
    subscribeSession((current) => {
      renderSessionBanner(current);
    });
    void loadInitialSession().catch(() => {
      setSessionState({ authenticated: false, user: null });
    });
    connectSessionStream();
    initSseDemoPanel();
  });
})();
