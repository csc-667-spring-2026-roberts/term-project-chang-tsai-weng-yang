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
  // Source of truth for "am I the host?" - set when this browser
  // *creates* a room. Don't try to derive this from the SSE payload
  // because the broadcast schema (player1Id/player2Id) doesn't carry
  // `created_by` - that bug is what kept /start from ever firing.
  let iAmHost = false;

  async function getCurrentUserId() {
    if (currentUserId) return currentUserId;
    try {
      const response = await fetch("/auth/session", { credentials: "same-origin" });
      const data = await response.json();
      if (data.authenticated && data.user) {
        currentUserId = data.user.id;
        return currentUserId;
      }
    } catch (error) {
      console.error("Error fetching user session:", error);
    }
    return null;
  }

  function init() {
    if (!gameRoomModal) {
      console.error("Game room modal not found");
      return;
    }

    if (tabJoin) tabJoin.addEventListener("click", () => switchTab("join"));
    if (tabCreate) tabCreate.addEventListener("click", () => switchTab("create"));
    if (tabWaiting) tabWaiting.addEventListener("click", () => switchTab("waiting"));

    if (gameRoomCloseBtn) {
      gameRoomCloseBtn.addEventListener("click", () => closeModal());
    }
    if (gameRoomBackdrop) {
      gameRoomBackdrop.addEventListener("click", (e) => {
        if (e.target === gameRoomBackdrop) closeModal();
      });
    }

    if (btnJoinRoom) btnJoinRoom.addEventListener("click", () => joinRoom());
    if (inputRoomId) {
      inputRoomId.addEventListener("keypress", (e) => {
        if (e.key === "Enter") joinRoom();
      });
    }

    if (btnCreateRoom) btnCreateRoom.addEventListener("click", () => createRoom());
    if (btnCancelWait) btnCancelWait.addEventListener("click", () => cancelWaiting());

    if (btnNewGame) {
      btnNewGame.addEventListener("click", () => openModal());
    } else {
      console.error("New game button not found");
    }
  }

  function openModal() {
    if (!gameRoomModal) return;
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
    iAmHost = false;
  }

  function switchTab(tabName) {
    panelJoin?.classList.remove("active");
    panelCreate?.classList.remove("active");
    panelWaiting?.classList.remove("active");
    tabJoin?.classList.remove("active");
    tabCreate?.classList.remove("active");
    tabWaiting?.classList.remove("active");

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
      iAmHost = !!data.self_play; // Self-play uses the room creator as the local host.
      hideLoading(joinLoading);
      startGameOnMatch(data);
    } catch (error) {
      console.error("Error joining room:", error);
      showError(joinError, "Network error. Please try again.");
      hideLoading(joinLoading);
    }
  }

  async function createRoom() {
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
      iAmHost = true; // We created this room - we are the host.

      hideLoading(createLoading);
      showSuccess(createSuccess, data.id);
      subscribeToRoom(data.id);
    } catch (error) {
      console.error("Error creating room:", error);
      showError(createError, "Network error. Please try again.");
      hideLoading(createLoading);
    }
  }

  function subscribeToRoom(roomId) {
    if (eventSource) eventSource.close();

    eventSource = new EventSource(`/api/sse?room=game:room:${roomId.toUpperCase()}`);

    eventSource.addEventListener("game:matched", (event) => {
      const data = JSON.parse(event.data);
      startGameOnMatch(data);
    });

    eventSource.addEventListener("game:room_cancelled", () => {
      showError(createError || joinError, "The room has been cancelled by the creator.");
      resetForm();
      cancelWaiting();
    });

    eventSource.addEventListener("error", () => {
      eventSource?.close();
    });
  }

  function startGameOnMatch(roomData) {
    if (gameStarted) return;
    gameStarted = true;

    // Match payload comes in two shapes:
    //   Host (via SSE):     { roomId, player1Id, player2Id, status }
    //   Joiner (via fetch): { id, created_by, player_2_id, ... }
    // Trust the local iAmHost flag for our role; pull opponent id from
    // whichever field the payload happens to carry.
    const player1 = roomData.player1Id != null ? roomData.player1Id : roomData.created_by;
    const player2 = roomData.player2Id != null ? roomData.player2Id : roomData.player_2_id;
    const opponentId = iAmHost ? player2 : player1;

    const gameSession = {
      roomId: currentRoomId,
      playerId: currentUserId,
      opponentId: opponentId,
      isPlayer1: iAmHost,
      selfPlay: !!(roomData.selfPlay || roomData.self_play),
      startedAt: Date.now(),
    };

    localStorage.setItem("gameSession", JSON.stringify(gameSession));
    closeModal();

    window.dispatchEvent(new CustomEvent("game:start", { detail: gameSession }));
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
      }).catch(() => {});
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
    if (roomIdDisplay) roomIdDisplay.textContent = roomId;
    element.hidden = false;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
