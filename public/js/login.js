export function attachLoginForm({ onSuccess }) {
  const loginForm = document.getElementById('login-form');
  const loginMessage = document.getElementById('login-message');
  const loginEmailInput = document.getElementById('login-email');

  async function submitAuth(email, password) {
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password }),
    });

    const payload = await response.json().catch(() => ({ message: 'Login failed' }));
    if (!response.ok) {
      throw new Error(payload.message || 'Login failed');
    }

    return payload;
  }

  if (loginForm instanceof HTMLFormElement) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const formData = new FormData(loginForm);
      const email = String(formData.get('email') || '').trim();
      const password = String(formData.get('password') || '');

      if (loginMessage instanceof HTMLElement) {
        loginMessage.textContent = 'Logging in...';
      }

      try {
        const payload = await submitAuth(email, password);
        if (loginMessage instanceof HTMLElement) {
          loginMessage.textContent = payload.message || 'Login successful';
        }

        if (typeof onSuccess === 'function') {
          onSuccess();
        }
      } catch (error) {
        if (loginMessage instanceof HTMLElement) {
          loginMessage.textContent = error instanceof Error ? error.message : 'Login failed';
        }
      }
    });
  }

  return {
    focus() {
      if (loginEmailInput instanceof HTMLElement) {
        loginEmailInput.focus();
      }
    },
    clearMessage() {
      if (loginMessage instanceof HTMLElement) {
        loginMessage.textContent = '';
      }
    },
  };
}
