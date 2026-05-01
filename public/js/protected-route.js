export function attachProtectedRouteTester() {
  const button = document.getElementById('check-protected-route');
  const result = document.getElementById('protected-route-result');

  async function checkProtectedRoute() {
    const response = await fetch('/protected', {
      credentials: 'same-origin',
    });

    const payload = await response.json().catch(() => ({
      message: 'Unable to parse protected route response',
    }));

    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  }

  if (button instanceof HTMLElement) {
    button.addEventListener('click', async () => {
      if (result instanceof HTMLElement) {
        result.textContent = 'Checking /protected...';
      }

      try {
        const response = await checkProtectedRoute();

        if (result instanceof HTMLElement) {
          result.textContent = JSON.stringify(
            {
              ok: response.ok,
              status: response.status,
              response: response.payload,
            },
            null,
            2,
          );
        }
      } catch (_error) {
        if (result instanceof HTMLElement) {
          result.textContent = 'Failed to reach /protected';
        }
      }
    });
  }
}
