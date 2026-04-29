// Game Initialization
(() => {
  let gameSession = null;
  let gameActive = false;
  let opponentNickname = "Opponent";

  const leaveButton = document.querySelector("#btn-leave-game");

  // Listen for game:start event from game-room.js
  window.addEventListener("game:start", (event) => {
    console.log("game:start event received", event.detail);
    gameSession = event.detail;
    fetchOpponentNickname();
    initializeGame(gameSession);
    if (leaveButton) leaveButton.hidden = false;
  });

  // Check if there's an existing game session when page loads
  function checkExistingSession() {
    const stored = localStorage.getItem("gameSession");
    if (stored) {
      try {
        gameSession = JSON.parse(stored);
        const age = Date.now() - gameSession.startedAt;
        // Consider session valid if less than 1 hour old
        if (age < 3600000) {
          // Verify user is still authenticated
          verifyAuthenticationBeforeRestore();
          return;
        }
      } catch (e) {
        console.error("Error parsing stored game session:", e);
      }
      localStorage.removeItem("gameSession");
    }
  }

  async function verifyAuthenticationBeforeRestore() {
    try {
      const response = await fetch("/auth/session", { credentials: "same-origin" });
      const data = await response.json();
      if (data.authenticated) {
        console.log("Restoring existing game session:", gameSession);
        fetchOpponentNickname();
        initializeGame(gameSession);
        if (leaveButton) leaveButton.hidden = false;
      } else {
        // User is not authenticated, clear the session
        localStorage.removeItem("gameSession");
        console.log("Game session cleared - user not authenticated");
      }
    } catch (error) {
      console.error("Error verifying authentication:", error);
      localStorage.removeItem("gameSession");
    }
  }

  async function fetchOpponentNickname() {
    if (!gameSession || !gameSession.opponentId) return;

    try {
      const response = await fetch(`/api/profile/user/${gameSession.opponentId}`, {
        credentials: "same-origin",
      });
      if (response.ok) {
        const data = await response.json();
        opponentNickname = data.nickname || "Opponent";
        console.log("Opponent nickname:", opponentNickname);
        // Redraw canvas with actual nickname
        if (gameActive && window.__gameState) {
          redrawGameInfo();
        }
      }
    } catch (error) {
      console.error("Error fetching opponent nickname:", error);
    }
  }

  function initializeGame(session) {
    if (gameActive) {
      console.log("Game already active");
      return;
    }

    console.log("=== GAME INITIALIZED ===");
    console.log("Room ID:", session.roomId);
    console.log("Opponent ID:", session.opponentId);
    console.log("You are:", session.isPlayer1 ? "Player 1" : "Player 2");
    console.log("Game session:", session);

    gameActive = true;

    // Get canvas and context
    const canvas = document.querySelector("#canvas");
    if (!canvas) {
      console.error("Canvas not found");
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error("Canvas context not available");
      return;
    }

    // Store game state in window for other scripts to access
    window.__gameState = {
      session,
      isActive: true,
      canvas,
      ctx,
      startTime: Date.now(),
      opponentNickname,
    };

    // Draw initial game info
    redrawGameInfo();

    // Subscribe to room cancellation events via SSE
    subscribeToRoomUpdates(session.roomId);

    // Emit event that game is ready
    window.dispatchEvent(new CustomEvent("game:ready", { detail: session }));

    console.log("Game initialized and ready to play");
  }

  function redrawGameInfo() {
    if (!window.__gameState) return;
    
    const canvas = window.__gameState.canvas;
    const ctx = window.__gameState.ctx;
    const session = window.__gameState.session;

    // Clear canvas and show game is active
    ctx.fillStyle = "#1b2d42";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw game header
    ctx.fillStyle = "#c9a227";
    ctx.font = "24px Arial";
    ctx.textAlign = "center";
    ctx.fillText("GAME MATCHED!", canvas.width / 2, 40);

    ctx.fillStyle = "#dce8f5";
    ctx.font = "16px Arial";
    ctx.fillText(`Room: ${session.roomId}`, canvas.width / 2, 80);
    ctx.fillText(
      `Playing as: ${session.isPlayer1 ? "Player 1" : "Player 2"}`,
      canvas.width / 2,
      110,
    );
    ctx.fillText("Waiting for opponent connection...", canvas.width / 2, 150);

    // Draw centered box with game info
    const boxWidth = 300;
    const boxHeight = 200;
    const boxX = (canvas.width - boxWidth) / 2;
    const boxY = (canvas.height - boxHeight) / 2;

    ctx.strokeStyle = "#c9a227";
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

    ctx.fillStyle = "#c9a227";
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Gin Rummy", canvas.width / 2, boxY + 40);

    ctx.fillStyle = "#dce8f5";
    ctx.font = "14px Arial";
    ctx.fillText(`Room: ${session.roomId}`, canvas.width / 2, boxY + 80);
    ctx.fillText(
      `vs ${opponentNickname}`,
      canvas.width / 2,
      boxY + 110,
    );
    ctx.fillText("Ready to play!", canvas.width / 2, boxY + 140);
  }

  function subscribeToRoomUpdates(roomId) {
    const eventSource = new EventSource(`/api/subscribe?room=game:room:${roomId}`);

    eventSource.addEventListener("game:room_cancelled", () => {
      console.log("Opponent left the game!");
      alert("Your opponent left the game. Returning to home...");
      endGame();
      window.location.href = "/";
      eventSource.close();
    });

    eventSource.addEventListener("error", () => {
      console.error("SSE connection error");
      eventSource.close();
    });

    // Store event source so we can close it when leaving
    if (window.__gameState) {
      window.__gameState.eventSource = eventSource;
    }
  }

  function endGame() {
    gameActive = false;
    localStorage.removeItem("gameSession");
    if (window.__gameState && window.__gameState.eventSource) {
      window.__gameState.eventSource.close();
    }
    window.__gameState = null;
    if (leaveButton) leaveButton.hidden = true;
    console.log("Game ended");
  }

  function leaveGame() {
    if (gameSession) {
      fetch(`/api/game/rooms/${gameSession.roomId}/cancel`, {
        method: "POST",
        credentials: "same-origin",
      }).catch(console.error);
    }
    endGame();
    window.location.href = "/";
  }

  // Leave button click handler
  if (leaveButton) {
    leaveButton.addEventListener("click", leaveGame);
  }

  // Listen for game end
  window.addEventListener("game:end", () => {
    endGame();
  });

  // Initialize on page load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkExistingSession);
  } else {
    checkExistingSession();
  }
})();
