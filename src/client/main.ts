interface SessionState {
  authenticated: boolean;
  user: {
    id: number;
    email: string;
  } | null;
}

type SessionListener = (state: SessionState) => void;

const state: SessionState = {
  authenticated: false,
  user: null,
};

const listeners = new Set<SessionListener>();
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10_000;

function setSessionState(next: SessionState): void {
  state.authenticated = next.authenticated;
  state.user = next.user;

  for (const listener of listeners) {
    listener({ ...state });
  }
}

function subscribeSession(listener: SessionListener): () => void {
  listeners.add(listener);
  listener({ ...state });
  return () => {
    listeners.delete(listener);
  };
}

function renderSessionBanner(current: SessionState): void {
  const template = document.querySelector<HTMLTemplateElement>("#session-banner-tpl");
  const container = document.querySelector<HTMLElement>("#session-banner");
  if (!template || !container) {
    return;
  }

  const clone = template.content.cloneNode(true) as DocumentFragment;
  const statusEl = clone.querySelector<HTMLElement>("[data-status]");
  const emailEl = clone.querySelector<HTMLElement>("[data-email]");

  if (statusEl) {
    statusEl.textContent = current.authenticated ? "Logged in" : "Guest";
    statusEl.className = current.authenticated ? "session-dot online" : "session-dot offline";
  }

  if (emailEl) {
    emailEl.textContent = current.authenticated && current.user ? current.user.email : "";
  }

  container.replaceChildren(clone);
}

async function loadInitialSession(): Promise<void> {
  const response = await fetch("/auth/session", { credentials: "same-origin" });
  const data = (await response.json()) as SessionState;

  setSessionState({
    authenticated: data.authenticated,
    user: data.user ?? null,
  });
}

function connectSessionStream(): void {
  let source: EventSource | null = null;
  let retries = 0;
  let reconnectTimer: number | null = null;

  const clearReconnectTimer = (): void => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = (): void => {
    clearReconnectTimer();
    retries += 1;
    const waitMs = Math.min(RECONNECT_BASE_MS * 2 ** (retries - 1), RECONNECT_MAX_MS);
    reconnectTimer = window.setTimeout(() => {
      open();
    }, waitMs);
  };

  const open = (): void => {
    clearReconnectTimer();
    if (source) {
      source.close();
    }

    source = new EventSource("/api/sse");

    source.addEventListener("connected", () => {
      retries = 0;
    });

    source.addEventListener("session:update", (event: MessageEvent<string>) => {
      const parsed = JSON.parse(event.data) as SessionState;
      setSessionState({
        authenticated: parsed.authenticated,
        user: parsed.user ?? null,
      });
    });


    source.onerror = (): void => {
      if (source) {
        source.close();
      }
      scheduleReconnect();
    };
  };

  open();
}

type LogKind = "info" | "event" | "error";

let demoSource: EventSource | null = null;

function appendDemoLog(text: string, kind: LogKind = "info"): void {
  const logEl = document.querySelector<HTMLElement>("#sse-message-log");
  if (!logEl) return;
  logEl.querySelector(".sse-placeholder")?.remove();

  const line = document.createElement("div");
  line.className = `sse-log-line sse-log-${kind}`;
  line.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function renderRoomBadges(rooms: string[]): void {
  const badgesEl = document.querySelector<HTMLElement>("#sse-room-badges");
  if (!badgesEl) return;
  badgesEl.innerHTML = "";
  for (const room of rooms) {
    const badge = document.createElement("span");
    badge.className = "sse-badge";
    badge.textContent = room;
    badgesEl.appendChild(badge);
  }
}

function setConnectBtnState(label: string, disabled: boolean): void {
  const btn = document.querySelector<HTMLButtonElement>("#sse-room-connect");
  if (!btn) return;
  btn.textContent = label;
  btn.disabled = disabled;
}

function connectDemoStream(channels: string): void {
  demoSource?.close();
  setConnectBtnState("Connecting…", true);

  const source = new EventSource(`/api/sse?channels=${encodeURIComponent(channels)}`);
  demoSource = source;

  source.addEventListener("connected", (ev: MessageEvent<string>) => {
    const payload = JSON.parse(ev.data) as { rooms: string[] };
    renderRoomBadges(payload.rooms);
    appendDemoLog(`Connected · rooms: [${payload.rooms.join(", ")}]`);
    setConnectBtnState("Reconnect", false);
  });

  source.addEventListener("demo:update", (ev: MessageEvent<string>) => {
    const payload = JSON.parse(ev.data) as { message?: string };
    appendDemoLog(`demo:update  →  ${payload.message ?? ev.data}`, "event");
  });

  source.onerror = (): void => {
    appendDemoLog("Connection lost — reconnecting…", "error");
    setConnectBtnState("Reconnect", false);
  };
}

async function sendDemoBroadcast(rooms: string[], message: string): Promise<void> {
  try {
    const res = await fetch("/api/events/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rooms, event: "demo:update", data: { message } }),
    });
    const body = (await res.json()) as { delivered: number };
    appendDemoLog(`Sent to [${rooms.join(", ")}] → delivered to ${String(body.delivered)} subscriber(s)`);
  } catch {
    appendDemoLog("Broadcast failed", "error");
  }
}

function initSseDemoPanel(): void {
  const roomInput = document.querySelector<HTMLInputElement>("#sse-room-input");
  const connectBtn = document.querySelector<HTMLButtonElement>("#sse-room-connect");
  const broadcastRoomsInput = document.querySelector<HTMLInputElement>("#sse-broadcast-rooms");
  const broadcastMsgInput = document.querySelector<HTMLInputElement>("#sse-broadcast-msg");
  const broadcastSendBtn = document.querySelector<HTMLButtonElement>("#sse-broadcast-send");

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
