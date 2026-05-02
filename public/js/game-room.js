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
  const waitingPanel = document.querySelector("#panel-waiting");

  // New Game Button
  const btnNewGame = document.querySelector("#btn-new-game");

  // State
  let currentRoomId = null;
  let currentUserId = null;
  let eventSource = null;
  let gameStarted = false;
  let iAmHost = false;
  let playerCount = 0;
  let btnStartGame = null;
  let playerCountDisplay = null;
  let waitingMessage = null;

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
    
    // Clean up joined room info
    const joinedRoomInfo = panelJoin?.querySelector(".joined-room-info");
    if (joinedRoomInfo) joinedRoomInfo.remove();
    
    // Clean up player displays
    if (playerCountDisplay) {
      playerCountDisplay.remove();
      playerCountDisplay = null;
    }
    if (btnStartGame) {
      btnStartGame.remove();
      btnStartGame = null;
    }
    if (waitingMessage) {
      waitingMessage.remove();
      waitingMessage = null;
    }
    
    currentRoomId = null;
    iAmHost = false;
    playerCount = 0;
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
      iAmHost = false; // We joined, not created
      hideLoading(joinLoading);
      
      // Show joined room info in the join panel
      playerCount = [data.created_by, data.player_2_id, data.player_3_id, data.player_4_id].filter(id => id).length;
      setupJoinedRoomInfo(data);
      subscribeToRoom(data.id);
    } catch (error) {
      console.error("Error joining room:", error);
      showError(joinError, "Network error. Please try again.");
      hideLoading(joinLoading);
    }
  }

  function setupJoinedRoomInfo(roomData) {
    // Create a container for room info in the join panel if it doesn't exist
    let roomInfoContainer = panelJoin?.querySelector(".joined-room-info");
    if (!roomInfoContainer && panelJoin) {
      roomInfoContainer = document.createElement("div");
      roomInfoContainer.className = "joined-room-info game-room-success";
      panelJoin.appendChild(roomInfoContainer);
    }

    if (roomInfoContainer) {
      const playerCount = [roomData.created_by, roomData.player_2_id, roomData.player_3_id, roomData.player_4_id].filter(id => id).length;
      roomInfoContainer.innerHTML = `
        <p>Joined Room!</p>
        <p>Room ID: <strong>${roomData.id}</strong></p>
        <p style="margin: 20px 0; font-weight: bold;">Waiting for host to start the game...</p>
        <p>Players: ${playerCount}/4</p>
      `;
      roomInfoContainer.hidden = false;
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
      iAmHost = true; // We created this room
      playerCount = 1; // Just us for now

      hideLoading(createLoading);
      showSuccess(createSuccess, data.id);
      
      // Setup waiting panel in the create tab
      setupCreateRoomWaiting();
      subscribeToRoom(data.id);
    } catch (error) {
      console.error("Error creating room:", error);
      showError(createError, "Network error. Please try again.");
      hideLoading(createLoading);
    }
  }

  function setupCreateRoomWaiting() {
    // Remove old elements from success section
    const successSection = createSuccess?.parentElement;
    if (successSection) {
      const oldPlayerList = successSection.querySelector(".player-list-display");
      if (oldPlayerList) oldPlayerList.remove();
      const oldButton = successSection.querySelector(".btn-start-game");
      if (oldButton) oldButton.remove();
    }

    // Add player list display
    if (createSuccess && !playerCountDisplay) {
      playerCountDisplay = document.createElement("div");
      playerCountDisplay.className = "player-list-display";
      createSuccess.parentElement?.appendChild(playerCountDisplay);
    }

    if (playerCountDisplay) {
      playerCountDisplay.innerHTML = `
        <p style="margin-top: 20px; font-weight: bold;">Players in room:</p>
        <p style="margin: 10px 0; font-size: 14px;">Players: ${playerCount}/4</p>
      `;
    }

    // Add start button if host
    if (iAmHost && !btnStartGame) {
      btnStartGame = document.createElement("button");
      btnStartGame.className = "btn-start-game game-room-action-btn";
      btnStartGame.textContent = "Start Game";
      btnStartGame.disabled = playerCount < 2;
      btnStartGame.addEventListener("click", startGame);
      
      if (createSuccess && createSuccess.parentElement) {
        createSuccess.parentElement.appendChild(btnStartGame);
      }
    } else if (btnStartGame) {
      btnStartGame.disabled = playerCount < 2;
    }
  }

  function updateWaitingPanel() {
    // Remove old elements
    if (waitingPanel) {
      const oldPlayerCount = waitingPanel.querySelector(".player-count-display");
      if (oldPlayerCount) oldPlayerCount.remove();
      const oldButton = waitingPanel.querySelector(".btn-start-game");
      if (oldButton) oldButton.remove();
      const oldMessage = waitingPanel.querySelector(".waiting-message");
      if (oldMessage) oldMessage.remove();
    }

    // Add player count display
    if (waitingPanel && !playerCountDisplay) {
      playerCountDisplay = document.createElement("p");
      playerCountDisplay.className = "player-count-display";
      waitingPanel.insertBefore(playerCountDisplay, waitingPanel.querySelector(".game-room-waiting-indicator"));
    }

    if (playerCountDisplay) {
      playerCountDisplay.textContent = `Players in room: ${playerCount}/4`;
    }

    // Add start button if host
    if (iAmHost && !btnStartGame) {
      btnStartGame = document.createElement("button");
      btnStartGame.className = "btn-start-game game-room-action-btn";
      btnStartGame.textContent = "Start Game";
      btnStartGame.disabled = playerCount < 2;
      btnStartGame.addEventListener("click", startGame);
      
      const waitingIndicator = waitingPanel?.querySelector(".game-room-waiting-indicator");
      if (waitingIndicator && waitingPanel) {
        waitingPanel.insertBefore(btnStartGame, waitingIndicator);
      }
    } else if (btnStartGame) {
      btnStartGame.disabled = playerCount < 2;
    }

    // Add waiting message for non-host
    if (!iAmHost && !waitingMessage) {
      waitingMessage = document.createElement("p");
      waitingMessage.className = "waiting-message";
      waitingMessage.textContent = "Waiting for the host to start the game...";
      waitingPanel?.appendChild(waitingMessage);
    }
  }

  function updateWaitingPanel() {
    // Remove old elements
    if (waitingPanel) {
      const oldPlayerCount = waitingPanel.querySelector(".player-count-display");
      if (oldPlayerCount) oldPlayerCount.remove();
      const oldButton = waitingPanel.querySelector(".btn-start-game");
      if (oldButton) oldButton.remove();
      const oldMessage = waitingPanel.querySelector(".waiting-message");
      if (oldMessage) oldMessage.remove();
    }

    // Add player count display
    if (waitingPanel && !playerCountDisplay) {
      playerCountDisplay = document.createElement("p");
      playerCountDisplay.className = "player-count-display";
      waitingPanel.insertBefore(playerCountDisplay, waitingPanel.querySelector(".game-room-waiting-indicator"));
    }

    if (playerCountDisplay) {
      playerCountDisplay.textContent = `Players in room: ${playerCount}/4`;
    }

    // Add start button if host
    if (iAmHost && !btnStartGame) {
      btnStartGame = document.createElement("button");
      btnStartGame.className = "btn-start-game game-room-action-btn";
      btnStartGame.textContent = "Start Game";
      btnStartGame.disabled = playerCount < 2;
      btnStartGame.addEventListener("click", startGame);
      
      const waitingIndicator = waitingPanel?.querySelector(".game-room-waiting-indicator");
      if (waitingIndicator && waitingPanel) {
        waitingPanel.insertBefore(btnStartGame, waitingIndicator);
      }
    } else if (btnStartGame) {
      btnStartGame.disabled = playerCount < 2;
    }

    // Add waiting message for non-host
    if (!iAmHost && !waitingMessage) {
      waitingMessage = document.createElement("p");
      waitingMessage.className = "waiting-message";
      waitingMessage.textContent = "Waiting for the host to start the game...";
      waitingPanel?.appendChild(waitingMessage);
    }
  }

  function subscribeToRoom(roomId) {
    if (eventSource) eventSource.close();

    eventSource = new EventSource(`/api/sse?room=game:room:${roomId.toUpperCase()}`);

    eventSource.addEventListener("game:player_joined", (event) => {
      const data = JSON.parse(event.data);
      playerCount = data.playerCount;
      // Update the display
      if (iAmHost) {
        // Update create room waiting display
        if (playerCountDisplay) {
          playerCountDisplay.innerHTML = `
            <p style="margin-top: 20px; font-weight: bold;">Players in room:</p>
            <p style="margin: 10px 0; font-size: 14px;">Players: ${playerCount}/4</p>
          `;
        }
        if (btnStartGame) {
          btnStartGame.disabled = playerCount < 2;
        }
      } else {
        // Update joined room display
        const roomInfo = panelJoin?.querySelector(".joined-room-info");
        if (roomInfo) {
          const playerLine = roomInfo.querySelector("p:last-child");
          if (playerLine) {
            playerLine.textContent = `Players: ${playerCount}/4`;
          }
        }
      }
    });

    eventSource.addEventListener("game:started", (event) => {
      const data = JSON.parse(event.data);
      startGameOnMatch({ roomId: data.roomId });
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

  async function startGame() {
    if (!iAmHost || playerCount < 2) {
      showError(createError, "Cannot start game: need at least 2 players");
      return;
    }

    if (!btnStartGame) return;
    btnStartGame.disabled = true;

    try {
      const response = await fetch(`/api/game/rooms/${currentRoomId}/start`, {
        method: "POST",
        credentials: "same-origin",
      });

      if (!response.ok) {
        const data = await response.json();
        showError(createError, data.message || "Failed to start game");
        if (btnStartGame) btnStartGame.disabled = false;
        return;
      }

      // The SSE event will trigger startGameOnMatch
    } catch (error) {
      console.error("Error starting game:", error);
      showError(createError, "Network error. Please try again.");
      if (btnStartGame) btnStartGame.disabled = false;
    }
  }

  function startGameOnMatch(roomData) {
    if (gameStarted) return;
    gameStarted = true;

    const gameSession = {
      roomId: currentRoomId || roomData.roomId,
      playerId: currentUserId,
      isPlayer1: iAmHost,
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
