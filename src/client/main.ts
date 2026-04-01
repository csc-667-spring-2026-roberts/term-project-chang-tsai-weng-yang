interface SessionResponse {
  authenticated: boolean;
  user?: {
    id: number;
    email: string;
  };
}

async function renderSessionBanner(): Promise<void> {
  const template = document.querySelector<HTMLTemplateElement>('#session-banner-tpl');
  const container = document.querySelector<HTMLElement>('#session-banner');
  if (!template || !container) return;

  try {
    const res = await fetch('/auth/session', { credentials: 'same-origin' });
    const data = (await res.json()) as SessionResponse;

    const clone = template.content.cloneNode(true) as DocumentFragment;
    const statusEl = clone.querySelector<HTMLElement>('[data-status]');
    const emailEl = clone.querySelector<HTMLElement>('[data-email]');

    if (statusEl) {
      statusEl.textContent = data.authenticated ? 'Logged in' : 'Guest';
      statusEl.className = data.authenticated ? 'session-dot online' : 'session-dot offline';
    }
    if (emailEl) {
      emailEl.textContent = data.authenticated && data.user ? data.user.email : '';
    }

    container.replaceChildren(clone);
  } catch {
    container.textContent = '';
  }
}

document.addEventListener('DOMContentLoaded', (): void => {
  void renderSessionBanner();
});
