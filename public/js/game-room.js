(() => {
  // Game Room Modal Management
  const gameRoomModal = document.querySelector("#game-room-modal");
  const gameRoomBackdrop = gameRoomModal ? gameRoomModal.querySelector(".game-room-backdrop") : null;
  const gameRoomCloseBtn = gameRoomModal ? gameRoomModal.querySelector(".game-room-close") : null;

  // Tabs
  const tabJoin = document.querySelector("#tab-join");
  const tabCreate = document.querySelector("#tab-create");
  const tabWaiting = document.querySelector("#tab-waiting");

  // Panels
  const panelJoin = document.querySelector("#panel-join");
  const panelCreate = document.querySelector("#panel-create");
  const panelWaiting = document.querySelector("#panel-waiting");

  // Join Game Elements
  const inputRoomId = document.querySelector("#input-room-id");
  const btnJoinRoom = document.querySelector("#btn-join-room");
  const joinError = document.querySelector("#join-error");
  const joinLoading = document.querySelector("#join-loading");

  // Create Room Elements
  const btnCreateRoom = document.querySelector("#btn-create-room");
  const createError = document.querySelector("#create-error");
  const createLoading = document.querySelector("#create-loading");
  const createSuccess = document.querySelector("#create-success");
  const roomIdDisplay = document.querySelector("#room-id-display");

  // Waiting Elements
  const btnCancelWait = document.querySelector("#btn-cancel-wait");

  // New Game Button
  const btnNewGame = document.querySelector("#btn-new-game");

  // State
  let currentRoomId = null;
  let currentUserId = null;
  let eventSource = null;
  let gameStarted = false;

  // Get current user ID from session
  async function getCurrentUserId() {
    if (currentUserId) return currentUserId;

    try {
      const response = await fetch("/auth/session", { credentials: "same-origin" });
      const data = await response.json();
      if (data.authenticated && data.user) {
        currentUserId = data.user.id;
        console.log("Current user ID:", currentUserId);
        return currentUserId;
      }
    } catch (error) {
      console.error("Error fetching user session:", error);
    }
    return null;
  }

  // Initialize
  function init() {
    if (!gameRoomModal) {
      console.error("Game room modal not found");
      return;
    }

    console.log("Game room modal initialized");

    // Tab switching
    if (tabJoin) tabJoin.addEventListener("click", () => switchTab("join"));
    if (tabCreate) tabCreate.addEventListener("click", () => switchTab("create"));
    if (tabWaiting) tabWaiting.addEventListener("click", () => switchTab("waiting"));

    // Close modal
    if (gameRoomCloseBtn) {
      gameRoomCloseBtn.addEventListener("click", () => closeModal());
    }
    if (gameRoomBackdrop) {
      gameRoomBackdrop.addEventListener("click", (e) => {
        if (e.target === gameRoomBackdrop) {
          closeModal();
        }
      });
    }

    // Join room
    if (btnJoinRoom) btnJoinRoom.addEventListener("click", () => joinRoom());
    if (inputRoomId) {
      inputRoomId.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          joinRoom();
        }
      });
    }

    // Create room
    if (btnCreateRoom) btnCreateRoom.addEventListener("click", () => createRoom());

    // Cancel waiting
    if (btnCancelWait) btnCancelWait.addEventListener("click", () => cancelWaiting());

    // New game button
    if (btnNewGame) {
      console.log("New game button found, attaching listener");
      btnNewGame.addEventListener("click", () => {
        console.log("New game button clicked");
        openModal();
      });
    } else {
      console.error("New game button not found");
    }
  }

  function openModal() {
    if (!gameRoomModal) {
      console.error("Modal not found");
      return;
    }
    console.log("Opening game room modal");
    gameRoomModal.hidden = false;
    resetForm();
  }

  function closeModal() {
    if (!gameRoomModal) return;
    gameRoomModal.hidden = true;
    cancelWaiting();
    resetForm();
  }

  function resetForm() {
    if (inputRoomId) inputRoomId.value = "";
    if (joinError) joinError.hidden = true;
    if (joinLoading) joinLoading.hidden = true;
    if (createError) createError.hidden = true;
    if (createLoading) createLoading.hidden = true;
    if (createSuccess) createSuccess.hidden = true;
    currentRoomId = null;
  }

  function switchTab(tabName) {
    // Hide all panels
    panelJoin?.classList.remove("active");
    panelCreate?.classList.remove("active");
    panelWaiting?.classList.remove("active");

    // Remove active from all tabs
    tabJoin?.classList.remove("active");
    tabCreate?.classList.remove("active");
    tabWaiting?.classList.remove("active");

    // Show selected panel and mark tab active
    if (tabName === "join") {
      panelJoin?.classList.add("active");
      tabJoin?.classList.add("active");
    } else if (tabName === "create") {
      panelCreate?.classList.add("active");
      tabCreate?.classList.add("active");
    } else if (tabName === "waiting") {
      panelWaiting?.classList.add("active");
      tabWaiting?.classList.add("active");
    }
  }

  async function joinRoom() {
    const roomId = inputRoomId?.value?.trim().toUpperCase();

    if (!roomId) {
      showError(joinError, "Please enter a room ID");
      return;
    }

    if (roomId.length !== 6) {
      showError(joinError, "Room ID must be 6 characters");
      return;
    }

    // Get current user ID first
    await getCurrentUserId();
    if (!currentUserId) {
      showError(joinError, "Authentication required");
      return;
    }

    clearError(joinError);
    showLoading(joinLoading);

    try {
      const response = await fetch("/api/game/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ roomId }),
      });

      if (!response.ok) {
        const data = await response.json();
        showError(joinError, data.message || "Failed to join room");
        hideLoading(joinLoading);
        return;
      }

      const data = await response.json();
      currentRoomId = data.id;

      hideLoading(joinLoading);
      startGameOnMatch(data);
    } catch (error) {
      console.error("Error joining room:", error);
      showError(joinError, "Network error. Please try again.");
      hideLoading(joinLoading);
    }
  }

  async function createRoom() {
    // Get current user ID first
    await getCurrentUserId();
    if (!currentUserId) {
      showError(createError, "Authentication required");
      return;
    }

    clearError(createError);
    showLoading(createLoading);

    try {
      const response = await fetch("/api/game/rooms/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const data = await response.json();
        showError(createError, data.message || "Failed to create room");
        hideLoading(createLoading);
        return;
      }

      const data = await response.json();
      currentRoomId = data.id;

      hideLoading(createLoading);
      showSuccess(createSuccess, data.id);

      // Subscribe to room updates
      subscribeToRoom(data.id);
    } catch (error) {
      console.error("Error creating room:", error);
      showError(createError, "Network error. Please try again.");
      hideLoading(createLoading);
    }
  }

  function subscribeToRoom(roomId) {
    if (eventSource) {
      eventSource.close();
    }

    // Subscribe to the specific game room via SSE
    eventSource = new EventSource(`/api/sse?room=game:room:${roomId.toUpperCase()}`);

    eventSource.addEventListener("game:matched", (event) => {
      const data = JSON.parse(event.data);
      console.log("Game matched!", data);
      startGameOnMatch(data);
    });

    eventSource.addEventListener("game:room_cancelled", () => {
      showError(
        createError || joinError,
        "The room has been cancelled by the creator.",
      );
      resetForm();
      cancelWaiting();
    });

    eventSource.addEventListener("error", () => {
      console.error("SSE connection error");
      eventSource?.close();
    });
  }

  function startGameOnMatch(roomData) {
    if (gameStarted) return;
    gameStarted = true;

    console.log("Game starting with room:", roomData);
    
    // Determine if current user is Player 1 or Player 2
    // Player 1 = room creator (created_by)
    // Player 2 = room joiner (player_2_id)
    const isPlayer1 = roomData.created_by === currentUserId;
    const opponentId = isPlayer1 ? roomData.player_2_id : roomData.created_by;

    // Store game session data in localStorage for the game to use
    const gameSession = {
      roomId: currentRoomId,
      playerId: currentUserId,
      opponentId: opponentId,
      isPlayer1: isPlayer1,
      startedAt: Date.now(),
    };
    
    localStorage.setItem("gameSession", JSON.stringify(gameSession));
    console.log("Game session stored:", gameSession);
    
    closeModal();

    // Emit a custom event that the main game logic can listen to
    window.dispatchEvent(
      new CustomEvent("game:start", {
        detail: gameSession,
      }),
    );
  }

  function cancelWaiting() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    if (currentRoomId) {
      fetch(`/api/game/rooms/${currentRoomId}/cancel`, {
        method: "POST",
        credentials: "same-origin",
      }).catch(console.error);
    }

    gameStarted = false;
    currentRoomId = null;
  }

  function showError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
  }

  function clearError(element) {
    if (!element) return;
    element.hidden = true;
    element.textContent = "";
  }

  function showLoading(element) {
    if (!element) return;
    element.hidden = false;
  }

  function hideLoading(element) {
    if (!element) return;
    element.hidden = true;
  }

  function showSuccess(element, roomId) {
    if (!element) return;
    if (roomIdDisplay) {
      roomIdDisplay.textContent = roomId;
    }
    element.hidden = false;
  }

  // Initialize on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
