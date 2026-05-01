// public/js/game-init.js
// Drives the actual Gin Rummy table once a room is matched.
// Pattern: fetch state on every relevant change, SSE only signals "refetch".
(() => {
  const SUIT_GLYPH = { H: "♥", D: "♦", C: "♣", S: "♠" };

  // Local state
  let session = null;          // { roomId, playerId, opponentId, isPlayer1, ... }
  let opponentNickname = "Opponent";
  let selfNickname = "You";
  let gameActive = false;
  let started = false;         // has /start been called by the host?
  let eventSource = null;
  let selectedCardId = null;
  let lastState = null;        // last response from /state

  // DOM lookups
  const $ = (sel) => document.querySelector(sel);
  const tableEmpty   = $("#table-empty");
  const tableGame    = $("#table-game");
  const opponentHand = $("#opponent-hand");
  const selfHand     = $("#self-hand");
  const discardTop   = $("#discard-top");
  const deckCount    = $("#deck-count");
  const hudRoom      = $("#hud-room");
  const hudTurnText  = $("#hud-turn-text");
  const hudTurnDot   = $("#hud-turn-dot");
  const hudOpponent  = $("#hud-opponent-name");
  const hudSelf      = $("#hud-self-name");
  const tableMessage = $("#table-message");
  const leaveButton  = $("#btn-leave-game");

  // Action affordances. The deck and discard piles in the center ARE the
  // draw buttons. We toggle .disabled on them to gate clicks. The sidebar
  // only keeps Discard (commit a selected card) and Knock (placeholder).
  const btnDiscard  = $("#btn-discard");
  const btnSort     = $("#btn-sort");
  const btnKnock    = $("#btn-knock");
  const pileDeck    = $("#pile-deck");
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

    if (hudRoom) hudRoom.textContent = session.roomId;

    fetchNicknames();
    bindControls();

    // Subscribe FIRST so we don't miss the broadcast that follows /start
    subscribeToRoom(session.roomId);

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

    const me        = session.playerId;
    const opp       = session.opponentId;
    const myHand    = state.cards.filter((c) => c.location === "hand" && c.player_id === me);
    const oppHand   = state.cards.filter((c) => c.location === "hand" && c.player_id === opp);
    const deck      = state.cards.filter((c) => c.location === "deck");
    const discardP  = state.cards.filter((c) => c.location === "discard");

    const RANK_ORDER = { A: 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
      "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13 };
    const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };
    myHand.sort((a, b) =>
      SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);

    if (selectedCardId && !myHand.some((c) => c.id === selectedCardId)) {
      selectedCardId = null;
    }

    // Player hand
    selfHand.replaceChildren();
    for (const card of myHand) {
      selfHand.appendChild(buildCard(card, true));
    }

    // Opponent hand (face-down backs)
    opponentHand.replaceChildren();
    for (let i = 0; i < oppHand.length; i++) {
      const back = document.createElement("div");
      back.className = "card back";
      opponentHand.appendChild(back);
    }

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
    hudTurnDot.classList.toggle("your-turn", myTurn);
    hudTurnText.textContent = myTurn ? "Your turn" : `${opponentNickname}'s turn`;

    // Pile and button gating.
    // 10 cards = haven't drawn yet (must draw); 11 cards = have drawn (must discard).
    const handSize = myHand.length;
    const mustDraw    = myTurn && handSize === 10;
    const mustDiscard = myTurn && handSize >= 11;

    pileDeck.classList.toggle("disabled", !(mustDraw && deck.length > 0));
    pileDiscard.classList.toggle("disabled", !(mustDraw && !!showTop));
    btnDiscard.disabled = !(mustDiscard && selectedCardId !== null);
    btnKnock.disabled = true; // not implemented
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
      const myHandSize = lastState.cards.filter(
        (c) => c.location === "hand" && c.player_id === session.playerId,
      ).length;
      if (myHandSize <= 10) {
        flashMessage("Draw a card first.");
        return;
      }
      selectedCardId = (selectedCardId === card.id) ? null : card.id;
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

    btnSort?.addEventListener("click", () => {
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
          if (hudOpponent) hudOpponent.textContent = opponentNickname;
        }
      } catch (e) { /* ignore */ }
    }

    try {
      const r = await fetch("/auth/session", { credentials: "same-origin" });
      if (r.ok) {
        const d = await r.json();
        if (d.user) {
          selfNickname = d.user.nickname || d.user.email || "You";
          if (hudSelf) hudSelf.textContent = selfNickname;
        }
      }
    } catch (e) { /* ignore */ }
  }

  function flashMessage(msg) {
    if (!tableMessage) return;
    tableMessage.textContent = msg;
    tableMessage.hidden = false;
    tableMessage.style.animation = "none";
    void tableMessage.offsetWidth; // force reflow
    tableMessage.style.animation = "";
    setTimeout(() => { if (tableMessage) tableMessage.hidden = true; }, 3000);
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
      } catch (e) { /* ignore, leaving anyway */ }
    }
    endGame(true);
  }

  window.addEventListener("game:end", () => endGame(false));
})();
