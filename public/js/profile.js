(() => {
  const container = document.querySelector("#profile-container");
  const loading = document.querySelector("#profile-loading");
  const emailDisplay = document.querySelector("#email-display");
  const nicknameInput = document.querySelector("#nickname-input");
  const btnSaveNickname = document.querySelector("#btn-save-nickname");
  const nicknameError = document.querySelector("#nickname-error");
  const nicknameSuccess = document.querySelector("#nickname-success");

  async function loadProfile() {
    if (loading) loading.hidden = false;
    if (container) container.hidden = true;

    try {
      const response = await fetch("/api/profile/", { credentials: "same-origin" });

      if (!response.ok) {
        window.location.href = "/";
        return;
      }

      const data = await response.json();

      if (emailDisplay) emailDisplay.textContent = data.email;
      if (nicknameInput) nicknameInput.value = data.nickname || "";

      if (loading) loading.hidden = true;
      if (container) container.hidden = false;
    } catch (error) {
      console.error("Error loading profile:", error);
      window.location.href = "/";
    }
  }

  async function saveNickname() {
    const nickname = nicknameInput?.value?.trim();

    if (!nickname) {
      showError("Please enter a nickname");
      return;
    }

    if (nickname.length > 100) {
      showError("Nickname is too long (max 100 characters)");
      return;
    }

    try {
      const response = await fetch("/api/profile/update-nickname", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ nickname }),
      });

      if (!response.ok) {
        const data = await response.json();
        showError(data.message || "Failed to save nickname");
        return;
      }

      showSuccess();
    } catch (error) {
      console.error("Error saving nickname:", error);
      showError("Network error. Please try again.");
    }
  }

  function showError(message) {
    if (nicknameError) {
      nicknameError.textContent = message;
      nicknameError.hidden = false;
    }
    if (nicknameSuccess) nicknameSuccess.hidden = true;
  }

  function showSuccess() {
    if (nicknameSuccess) nicknameSuccess.hidden = false;
    if (nicknameError) nicknameError.hidden = true;

    setTimeout(() => {
      if (nicknameSuccess) nicknameSuccess.hidden = true;
    }, 3000);
  }

  function init() {
    if (btnSaveNickname) {
      btnSaveNickname.addEventListener("click", saveNickname);
    }
    if (nicknameInput) {
      nicknameInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") saveNickname();
      });
    }

    loadProfile();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
