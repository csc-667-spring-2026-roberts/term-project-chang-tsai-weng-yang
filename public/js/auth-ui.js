import { attachLoginForm } from '/js/login.js';
import { attachProtectedRouteTester } from '/js/protected-route.js';
import { attachRegisterForm } from '/js/register.js';

const modal = document.getElementById('auth-modal');
const openLoginButton = document.getElementById('open-login');
const openRegisterButton = document.getElementById('open-register');
const logoutButton = document.getElementById('logout-button');
const loginTab = document.getElementById('login-tab');
const registerTab = document.getElementById('register-tab');
const loginPanel = document.getElementById('login-panel');
const registerPanel = document.getElementById('register-panel');
const loginContent = document.getElementById('login-content');
const registerContent = document.getElementById('register-content');
const authSessionState = document.getElementById('auth-session-state');

async function fetchSession() {
  const response = await fetch('/auth/session', { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error('Unable to load session');
  }

  return response.json();
}

async function logout() {
  const response = await fetch('/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  });
  const payload = await response.json().catch(() => ({ message: 'Logout failed' }));

  if (!response.ok) {
    throw new Error(payload.message || 'Logout failed');
  }

  return payload;
}

function setTab(mode) {
  if (loginTab instanceof HTMLElement) {
    loginTab.classList.toggle('active', mode === 'login');
  }

  if (registerTab instanceof HTMLElement) {
    registerTab.classList.toggle('active', mode === 'register');
  }

  if (loginPanel instanceof HTMLElement) {
    loginPanel.hidden = mode !== 'login';
  }

  if (registerPanel instanceof HTMLElement) {
    registerPanel.hidden = mode !== 'register';
  }
}

function closeModal() {
  if (modal instanceof HTMLElement) {
    modal.hidden = true;
  }
}

function updateAuthButtons(authenticated) {
  if (openLoginButton instanceof HTMLElement) {
    openLoginButton.hidden = authenticated;
  }

  if (openRegisterButton instanceof HTMLElement) {
    openRegisterButton.hidden = authenticated;
  }

  if (logoutButton instanceof HTMLElement) {
    logoutButton.hidden = !authenticated;
  }

  if (authSessionState instanceof HTMLElement) {
    authSessionState.textContent = authenticated
      ? 'Session active. Protected route should succeed.'
      : 'Logged out. Protected route should return 401.';
  }
}

async function loadFragment(target, url) {
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`Unable to load ${url}`);
  }

  target.innerHTML = await response.text();
}

async function initAuthUi() {
  try {
    await loadFragment(loginContent, '/page/login.html');
    await loadFragment(registerContent, '/page/register.html');
  } catch (error) {
    console.error('Failed to load auth forms:', error);

    if (loginContent instanceof HTMLElement) {
      loginContent.innerHTML = `
        <h2 id="auth-title">Login</h2>
        <form id="login-form" class="auth-form">
          <label for="login-email">Email</label>
          <input id="login-email" name="email" type="email" required />
          <label for="login-password">Password</label>
          <input id="login-password" name="password" type="password" required />
          <button type="submit">Login</button>
        </form>
        <p id="login-message" class="auth-message"></p>
      `;
    }

    if (registerContent instanceof HTMLElement) {
      registerContent.innerHTML = `
        <h2>Register</h2>
        <form id="register-form" class="auth-form">
          <label for="register-email">Email</label>
          <input id="register-email" name="email" type="email" required />
          <label for="register-password">Password</label>
          <input id="register-password" name="password" type="password" minlength="6" required />
          <button type="submit">Register</button>
        </form>
        <p id="register-message" class="auth-message"></p>
      `;
    }
  }

  const loginController = attachLoginForm({
    onSuccess() {
      updateAuthButtons(true);
      window.setTimeout(() => {
        closeModal();
      }, 500);
    },
  });

  const registerController = attachRegisterForm({
    onSuccess() {
      registerController.resetForm();
      updateAuthButtons(true);
      window.setTimeout(() => {
        closeModal();
      }, 500);
    },
  });

  function openModal(mode) {
    if (!(modal instanceof HTMLElement)) {
      return;
    }

    setTab(mode);
    loginController.clearMessage();
    registerController.clearMessage();
    modal.hidden = false;

    window.setTimeout(() => {
      if (mode === 'login') {
        loginController.focus();
      } else {
        registerController.focus();
      }
    }, 0);
  }

  if (openLoginButton instanceof HTMLElement) {
    openLoginButton.addEventListener('click', () => {
      openModal('login');
    });
  }

  if (openRegisterButton instanceof HTMLElement) {
    openRegisterButton.addEventListener('click', () => {
      openModal('register');
    });
  }

  if (loginTab instanceof HTMLElement) {
    loginTab.addEventListener('click', () => {
      setTab('login');
      loginController.focus();
    });
  }

  if (registerTab instanceof HTMLElement) {
    registerTab.addEventListener('click', () => {
      setTab('register');
      registerController.focus();
    });
  }

  if (modal instanceof HTMLElement) {
    modal.addEventListener('click', (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.dataset.closeModal === 'true') {
        closeModal();
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  });

  if (logoutButton instanceof HTMLElement) {
    logoutButton.addEventListener('click', async () => {
      try {
        await logout();
        updateAuthButtons(false);
      } catch (_error) {
        updateAuthButtons(true);
      }
    });
  }

  attachProtectedRouteTester();

  try {
    const session = await fetchSession();
    updateAuthButtons(Boolean(session.authenticated));
  } catch (_error) {
    updateAuthButtons(false);
  }
}

void initAuthUi();
