export function attachRegisterForm({ onSuccess }) {
  const registerForm = document.getElementById('register-form');
  const registerMessage = document.getElementById('register-message');
  const registerEmailInput = document.getElementById('register-email');

  async function submitAuth(email, password) {
    const response = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password }),
    });

    const payload = await response.json().catch(() => ({ message: 'Registration failed' }));
    if (!response.ok) {
      throw new Error(payload.message || 'Registration failed');
    }

    return payload;
  }

  if (registerForm instanceof HTMLFormElement) {
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const formData = new FormData(registerForm);
      const email = String(formData.get('email') || '').trim();
      const password = String(formData.get('password') || '');

      if (registerMessage instanceof HTMLElement) {
        registerMessage.textContent = 'Registering...';
      }

      try {
        const payload = await submitAuth(email, password);
        if (registerMessage instanceof HTMLElement) {
          registerMessage.textContent = payload.message || 'Registration successful';
        }

        if (typeof onSuccess === 'function') {
          onSuccess();
        }
      } catch (error) {
        if (registerMessage instanceof HTMLElement) {
          registerMessage.textContent =
            error instanceof Error ? error.message : 'Registration failed';
        }
      }
    });
  }

  return {
    focus() {
      if (registerEmailInput instanceof HTMLElement) {
        registerEmailInput.focus();
      }
    },
    resetForm() {
      if (registerForm instanceof HTMLFormElement) {
        registerForm.reset();
      }
    },
    clearMessage() {
      if (registerMessage instanceof HTMLElement) {
        registerMessage.textContent = '';
      }
    },
  };
}
