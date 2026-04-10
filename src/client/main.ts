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

document.addEventListener("DOMContentLoaded", () => {
  subscribeSession((current) => {
    renderSessionBanner(current);
  });

  void loadInitialSession().catch(() => {
    setSessionState({ authenticated: false, user: null });
  });

  connectSessionStream();
});
