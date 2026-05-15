// public/js/game-init.js
// Drives the actual Gin Rummy table once a room is matched.
// Pattern: fetch state on every relevant change, SSE only signals "refetch".
(() => {
  const SUIT_GLYPH = { H: "♥", D: "♦", C: "♣", S: "♠" };
  const RANK_ORDER = {
    A: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
    7: 7,
    8: 8,
    9: 9,
    10: 10,
    J: 11,
    Q: 12,
    K: 13,
  };
  const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };

  // Local state
  let session = null; // { roomId, playerId, opponentId, isPlayer1, ... }
  let opponentNickname = "Opponent";
  let selfNickname = "You";
  let currentUserId = null;
  let gameActive = false;
  let started = false; // has /start been called by the host?
  let eventSource = null;
  let selectedCardId = null;
  let lastState = null; // last response from /state
  let handSortMode = "suit";

  // DOM lookups
  const $ = (sel) => document.querySelector(sel);
  const tableEmpty = $("#table-empty");
  const tableGame = $("#table-game");
  const opponentHand = $("#opponent-hand");
  const selfHand = $("#self-hand");
  const discardTop = $("#discard-top");
  const deckCount = $("#deck-count");
  const hudRoom = $("#hud-room");
  const hudTurnText = $("#hud-turn-text");
  const hudTurnDot = $("#hud-turn-dot");
  const hudDeadwood = $("#hud-deadwood");
  const hudOpponent = $("#hud-opponent-name");
  const hudSelf = $("#hud-self-name");
  const tableMessage = $("#table-message");
  const leaveButton = $("#btn-leave-game");
  const btnNewGame = $("#btn-new-game");
  const roundResults = $("#round-results");
  const roundResultsList = $("#round-results-list");

  // Action affordances. The deck and discard piles in the center ARE the
  // draw buttons. We toggle .disabled on them to gate clicks. The sidebar
  // only keeps Discard (commit a selected card) and Knock (placeholder).
  const btnDiscard = $("#btn-discard");
  const btnSort = $("#btn-sort");
  const btnKnock = $("#btn-knock");
  const pileDeck = $("#pile-deck");
  const pileDiscard = $("#pile-discard");

  // Boot
  window.addEventListener("game:start", (event) => {
    session = event.detail;
    bootGame(session.isPlayer1);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restoreIfAny);
  } else {
    restoreIfAny();
  }

  // Restore an in-progress game across reloads
  function restoreIfAny() {
    const stored = localStorage.getItem("gameSession");
    if (!stored) return;
    try {
      const s = JSON.parse(stored);
      if (Date.now() - (s.startedAt || 0) > 1000 * 60 * 60) {
        localStorage.removeItem("gameSession");
        return;
      }
      fetch("/auth/session", { credentials: "same-origin" })
        .then((r) => r.json())
        .then((data) => {
          if (!data.authenticated) {
            localStorage.removeItem("gameSession");
            return;
          }
          session = s;
          // After a reload, /start has likely already been called; treat as guest.
          bootGame(false);
        })
        .catch(() => localStorage.removeItem("gameSession"));
    } catch (e) {
      localStorage.removeItem("gameSession");
    }
  }

  async function bootGame(asHost) {
    if (gameActive) return;
    gameActive = true;

    if (tableEmpty) tableEmpty.hidden = true;
    if (tableGame) tableGame.hidden = false;
    if (leaveButton) leaveButton.hidden = false;
    setNewGameEnabled(false);

    if (hudRoom) hudRoom.textContent = session.roomId;

    fetchNicknames();
    bindControls();

    // Subscribe FIRST so we don't miss the broadcast that follows /start
    subscribeToRoom(session.roomId);

    // Initialize chat for this session
    window.dispatchEvent(new CustomEvent("game:start", { detail: session }));

    if (asHost && !started) {
      try {
        await fetch(`/api/game/rooms/${session.roomId}/start`, {
          method: "POST",
          credentials: "same-origin",
        });
        started = true;
      } catch (err) {
        console.error("Failed to start game:", err);
        flashMessage("Could not start the game. Try again.");
      }
    }

    refreshState();
  }

  // Networking
  async function refreshState() {
    if (!session) return;
    try {
      const res = await fetch(`/api/game/rooms/${session.roomId}/state`, {
        credentials: "same-origin",
      });
      if (!res.ok) return;
      const data = await res.json();
      lastState = data;
      render(data);
    } catch (err) {
      console.error("State fetch failed:", err);
    }
  }

  async function postAction(path, body) {
    if (!session) return null;
    try {
      const res = await fetch(`/api/game/rooms/${session.roomId}/${path}`, {
        method: "POST",
        credentials: "same-origin",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flashMessage(data.message || "Action failed");
        return null;
      }
      return data;
    } catch (err) {
      console.error(err);
      flashMessage("Network error");
      return null;
    }
  }

  // SSE
  function subscribeToRoom(roomId) {
    if (eventSource) eventSource.close();

    const channel = `game:room:${roomId.toUpperCase()}`;
    eventSource = new EventSource(`/api/sse?room=${encodeURIComponent(channel)}`);

    eventSource.addEventListener("game:started", () => {
      started = true;
      refreshState();
    });

    eventSource.addEventListener("game:update", () => {
      refreshState();
    });

    eventSource.addEventListener("game:finished", () => {
      refreshState();
    });

    eventSource.addEventListener("game:chat", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (window.chatReceiveMessage) {
          window.chatReceiveMessage(data);
        }
      } catch (error) {
        console.error("Error parsing chat message:", error);
      }
    });

    eventSource.addEventListener("game:room_cancelled", () => {
      flashMessage("Opponent left. Returning home...");
      setTimeout(() => endGame(true), 1500);
    });

    eventSource.addEventListener("error", () => {
      // EventSource auto-reconnects; don't tear down here.
    });
  }

  // Rendering
  function render(state) {
    if (!state || !state.cards) return;
    if (roundResults) roundResults.hidden = !state.finished;

    const me = state.viewerPlayerId || session.playerId;
    const myHand = state.cards.filter((c) => c.location === "hand" && c.player_id === me);
    const deck = state.cards.filter((c) => c.location === "deck");
    const discardP = state.cards.filter((c) => c.location === "discard");

    myHand.sort(compareCardsForCurrentMode);

    if (selectedCardId && !myHand.some((c) => c.id === selectedCardId)) {
      selectedCardId = null;
    }

    // Player hand
    selfHand.replaceChildren();
    for (const card of myHand) {
      selfHand.appendChild(buildCard(card, true));
    }

    // Opponent seats. In 3-4 player games, each opponent gets a separate
    // visible hand instead of merging every back into one long row.
    opponentHand.replaceChildren();
    const allPlayers = state.activePlayers || []; // List of all player IDs
    const otherPlayers = allPlayers.filter((id) => id !== me);
    const playerCount = state.playerCount || allPlayers.length || 2;
    const cardsPerPlayer = playerCount === 2 ? 10 : 7;

    otherPlayers.forEach((playerId, index) => {
      const oppHand = state.cards.filter((c) => c.location === "hand" && c.player_id === playerId);
      const visibleBacks = normalizeOpponentBackCount(oppHand.length, cardsPerPlayer);
      const seat = document.createElement("div");
      seat.className = `opponent-seat ${seatClassForOpponent(index, otherPlayers.length)}`;

      const seatLabel = document.createElement("div");
      seatLabel.className = "opponent-seat-label";
      seatLabel.textContent =
        playerCount > 2 ? `Opponent ${index + 1} · ${visibleBacks}` : `Opponent · ${visibleBacks}`;

      const seatHand = document.createElement("div");
      seatHand.className = "hand opponent-seat-hand";

      for (let i = 0; i < visibleBacks; i++) {
        const back = document.createElement("div");
        back.className = "card back";
        seatHand.appendChild(back);
      }
      seat.append(seatLabel, seatHand);
      opponentHand.appendChild(seat);
    });

    // Deck count
    deckCount.textContent = String(deck.length);

    // Discard top: card with highest card_order (set by server on every discard)
    const showTop = discardP.length
      ? discardP.reduce((max, c) => {
          if (max === null) return c;
          const cKey = c.card_order != null ? c.card_order : c.id;
          const mKey = max.card_order != null ? max.card_order : max.id;
          return cKey > mKey ? c : max;
        }, null)
      : null;

    if (showTop) {
      paintCardFace(discardTop, showTop);
      discardTop.classList.remove("empty");
    } else {
      discardTop.replaceChildren();
      discardTop.className = "pile-card empty";
    }

    // HUD
    const myTurn = !!state.isMyTurn;
    updatePlayerLabels(me);
    hudTurnDot.classList.toggle("your-turn", myTurn);
    hudTurnText.textContent = state.finished
      ? "Round finished"
      : myTurn
        ? "Your turn"
        : `${opponentNickname}'s turn`;
    if (hudDeadwood) {
      hudDeadwood.textContent = String(state.currentDeadwood ?? "—");
    }
    renderResults(state);

    // Pile and button gating.
    // 2 players: 10 cards = haven't drawn yet (must draw); 11 cards = have drawn (must discard).
    // 3-4 players: 7 cards = haven't drawn yet (must draw); 8 cards = have drawn (must discard).
    const handSize = myHand.length;
    const mustDraw = myTurn && handSize === cardsPerPlayer;
    const mustDiscard = myTurn && handSize >= cardsPerPlayer + 1;
    const canDrawFromStock = deck.length > 0 || discardP.length > 1;

    pileDeck.classList.toggle("disabled", !(mustDraw && canDrawFromStock));
    pileDiscard.classList.toggle("disabled", !(mustDraw && !!showTop));
    btnDiscard.disabled = !(mustDiscard && selectedCardId !== null);
    btnKnock.disabled = !(mustDiscard && selectedCardId !== null);
    btnKnock.textContent = "Gin / Knock";

    if (state.finished) {
      pileDeck.classList.add("disabled");
      pileDiscard.classList.add("disabled");
      btnDiscard.disabled = true;
      btnKnock.disabled = true;
    }
  }

  function normalizeOpponentBackCount(handSize, cardsPerPlayer) {
    if (!Number.isFinite(handSize) || handSize < 0) return cardsPerPlayer;
    const maxExpectedDuringTurn = cardsPerPlayer + 1;
    return Math.min(handSize, maxExpectedDuringTurn);
  }

  function seatClassForOpponent(index, opponentCount) {
    if (opponentCount >= 3) {
      return ["seat-left", "seat-top", "seat-right"][index] || "seat-top";
    }

    if (opponentCount === 2) {
      return ["seat-left", "seat-top"][index] || "seat-top";
    }

    return "seat-top";
  }

  function compareCardsForCurrentMode(a, b) {
    const suitDiff = (SUIT_ORDER[a.suit] ?? 99) - (SUIT_ORDER[b.suit] ?? 99);
    const rankDiff = (RANK_ORDER[a.rank] ?? 99) - (RANK_ORDER[b.rank] ?? 99);

    if (handSortMode === "rank") {
      return rankDiff || suitDiff || a.id - b.id;
    }

    return suitDiff || rankDiff || a.id - b.id;
  }

  function toggleHandSortMode() {
    handSortMode = handSortMode === "suit" ? "rank" : "suit";
    updateSortButtonLabel();
  }

  function updateSortButtonLabel() {
    if (!btnSort) return;
    const nextMode = handSortMode === "suit" ? "rank" : "suit";
    btnSort.textContent = nextMode === "rank" ? "Sort by Rank" : "Sort by Suit";
    btnSort.title =
      nextMode === "rank"
        ? "Sort hand by number, then suit"
        : "Sort hand by suit, then number";
  }

  function buildCard(card, faceUp) {
    const el = document.createElement("div");
    el.className = `card suit-${card.suit}`;
    el.dataset.cardId = String(card.id);

    if (selectedCardId === card.id) el.classList.add("selected");
    if (!lastState || !lastState.isMyTurn) el.classList.add("disabled");

    if (faceUp) {
      const rank = document.createElement("div");
      rank.className = "card-rank";
      rank.textContent = card.rank;
      const suit = document.createElement("div");
      suit.className = "card-suit";
      suit.textContent = SUIT_GLYPH[card.suit] || card.suit;
      el.append(rank, suit);
    } else {
      el.classList.add("back");
    }

    el.addEventListener("click", () => {
      if (!lastState || !lastState.isMyTurn) return;
      const activePlayerId = lastState.viewerPlayerId || session.playerId;
      const myHandSize = lastState.cards.filter(
        (c) => c.location === "hand" && c.player_id === activePlayerId,
      ).length;
      // Determine required hand size based on player count
      const playerCount = lastState.playerCount || 2;
      const cardsPerPlayer = playerCount === 2 ? 10 : 7;
      const maxHandSizeBeforeDiscard = cardsPerPlayer;

      if (myHandSize <= maxHandSizeBeforeDiscard) {
        flashMessage("Draw a card first.");
        return;
      }
      selectedCardId = selectedCardId === card.id ? null : card.id;
      render(lastState);
    });

    return el;
  }

  function paintCardFace(target, card) {
    target.className = `pile-card card suit-${card.suit}`;
    target.replaceChildren();
    const rank = document.createElement("div");
    rank.className = "card-rank";
    rank.textContent = card.rank;
    const suit = document.createElement("div");
    suit.className = "card-suit";
    suit.textContent = SUIT_GLYPH[card.suit] || card.suit;
    target.append(rank, suit);
  }

  function updatePlayerLabels(activePlayerId) {
    const viewingOpponentSeat = session?.selfPlay && activePlayerId === session.opponentId;
    if (hudSelf) {
      hudSelf.textContent = viewingOpponentSeat ? opponentNickname : selfNickname;
    }
    if (hudOpponent) {
      // For multi-player games, show whose turn it is
      if (lastState && lastState.playerCount > 2) {
        hudOpponent.textContent = `Player ${activePlayerId}`;
      } else {
        hudOpponent.textContent = viewingOpponentSeat ? selfNickname : opponentNickname;
      }
    }
  }

  // Controls
  let bound = false;
  function bindControls() {
    if (bound) return;
    bound = true;

    pileDeck?.addEventListener("click", async () => {
      if (pileDeck.classList.contains("disabled")) return;
      await postAction("draw");
      refreshState();
    });

    pileDiscard?.addEventListener("click", async () => {
      if (pileDiscard.classList.contains("disabled")) return;
      await postAction("draw-discard");
      refreshState();
    });

    btnDiscard?.addEventListener("click", async () => {
      if (btnDiscard.disabled || selectedCardId === null) return;
      const cardId = selectedCardId;
      selectedCardId = null;
      await postAction("discard", { cardId });
      refreshState();
    });

    btnKnock?.addEventListener("click", async () => {
      if (btnKnock.disabled || selectedCardId === null || !lastState) return;
      const data = await postAction("declare", { discardCardId: selectedCardId });
      if (data) {
        selectedCardId = null;
        flashMessage(
          data.declaration === "gin" ? "Gin! Round finished." : "Knock accepted. Round finished.",
        );
        refreshState();
      }
    });

    updateSortButtonLabel();
    btnSort?.addEventListener("click", () => {
      toggleHandSortMode();
      if (lastState) render(lastState);
    });

    leaveButton?.addEventListener("click", leaveGame);
  }

  // Misc
  async function fetchNicknames() {
    if (!session) return;

    if (session.opponentId) {
      try {
        const r = await fetch(`/api/profile/user/${session.opponentId}`, {
          credentials: "same-origin",
        });
        if (r.ok) {
          const d = await r.json();
          opponentNickname = d.nickname || "Opponent";
          updatePlayerLabels(lastState?.viewerPlayerId || session.playerId);
        }
      } catch (e) {
        /* ignore */
      }
    }

    try {
      const r = await fetch("/auth/session", { credentials: "same-origin" });
      if (r.ok) {
        const d = await r.json();
        if (d.user) {
          selfNickname = d.user.nickname || d.user.email || "You";
          currentUserId = d.user.id;
          updatePlayerLabels(lastState?.viewerPlayerId || session.playerId);

          // Dispatch event for chat module to use userId
          window.dispatchEvent(
            new CustomEvent("game:chat:userId", {
              detail: { userId: d.user.id },
            }),
          );
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  function flashMessage(msg) {
    if (!tableMessage) return;
    tableMessage.textContent = msg;
    tableMessage.hidden = false;
    tableMessage.style.animation = "none";
    void tableMessage.offsetWidth; // force reflow
    tableMessage.style.animation = "";
    setTimeout(() => {
      if (tableMessage) tableMessage.hidden = true;
    }, 3000);
  }

  function renderResults(state) {
    if (!roundResultsList) return;
    roundResultsList.replaceChildren();

    if (!state.finished || !Array.isArray(state.results) || state.results.length === 0) {
      return;
    }

    for (const result of state.results) {
      const row = document.createElement("div");
      row.className = `round-result round-result-${result.outcome}`;

      const name = document.createElement("strong");
      name.textContent = result.user_id === currentUserId ? "You" : `Player ${result.user_id}`;

      const detail = document.createElement("span");
      detail.textContent = `${result.outcome.toUpperCase()} · deadwood ${result.deadwood_score} · score ${result.score}`;

      row.append(name, detail);
      roundResultsList.appendChild(row);
    }
  }

  function endGame(redirect) {
    gameActive = false;
    started = false;
    selectedCardId = null;
    lastState = null;
    localStorage.removeItem("gameSession");
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (tableEmpty) tableEmpty.hidden = false;
    if (tableGame) tableGame.hidden = true;
    if (leaveButton) leaveButton.hidden = true;
    if (roundResults) roundResults.hidden = true;
    setNewGameEnabled(true);

    // Hide chat panel when game ends
    if (window.chatHide) {
      window.chatHide();
    }

    if (redirect) window.location.href = "/";
  }

  async function leaveGame() {
    if (session) {
      // Wait for the server so it has a chance to broadcast
      // game:room_cancelled to the OTHER player before we redirect.
      // /leave (vs the old /cancel) works while a game is in progress
      // and is callable by either participant.
      try {
        await fetch(`/api/game/rooms/${session.roomId}/leave`, {
          method: "POST",
          credentials: "same-origin",
        });
      } catch (e) {
        /* ignore, leaving anyway */
      }
    }
    endGame(true);
  }

  function setNewGameEnabled(enabled) {
    if (!btnNewGame) return;
    btnNewGame.disabled = !enabled;
    btnNewGame.title = enabled ? "" : "Finish or leave the current game before starting a new one.";
  }

  window.addEventListener("game:end", () => endGame(false));
})();
