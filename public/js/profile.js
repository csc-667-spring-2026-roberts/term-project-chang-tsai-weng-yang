(() => {
  const container = document.querySelector("#profile-container");
  const loading = document.querySelector("#profile-loading");
  const profileAvatar = document.querySelector("#profile-avatar");
  const profileTitle = document.querySelector("#profile-title");
  const memberSince = document.querySelector("#profile-member-since");
  const heroWinRate = document.querySelector("#hero-win-rate");
  const heroWins = document.querySelector("#hero-wins");
  const heroScore = document.querySelector("#hero-score");
  const emailDisplay = document.querySelector("#email-display");
  const userIdDisplay = document.querySelector("#user-id-display");
  const nicknameInput = document.querySelector("#nickname-input");
  const btnSaveNickname = document.querySelector("#btn-save-nickname");
  const nicknameError = document.querySelector("#nickname-error");
  const nicknameSuccess = document.querySelector("#nickname-success");
  const statTotal = document.querySelector("#stat-total");
  const statCompleted = document.querySelector("#stat-completed");
  const statReady = document.querySelector("#stat-ready");
  const statHosted = document.querySelector("#stat-hosted");
  const statJoined = document.querySelector("#stat-joined");
  const statWaiting = document.querySelector("#stat-waiting");
  const statCancelled = document.querySelector("#stat-cancelled");
  const statResultGames = document.querySelector("#stat-result-games");
  const statWins = document.querySelector("#stat-wins");
  const statLosses = document.querySelector("#stat-losses");
  const statDraws = document.querySelector("#stat-draws");
  const statWinRate = document.querySelector("#stat-win-rate");
  const statTotalScore = document.querySelector("#stat-total-score");
  const statBestScore = document.querySelector("#stat-best-score");
  const statAverageScore = document.querySelector("#stat-average-score");
  const statGin = document.querySelector("#stat-gin");
  const statKnock = document.querySelector("#stat-knock");
  const lastRoom = document.querySelector("#profile-last-room");
  const activeRoomCount = document.querySelector("#active-room-count");
  const activeRoomsList = document.querySelector("#active-rooms-list");
  const activeRoomsEmpty = document.querySelector("#active-rooms-empty");
  const roomCount = document.querySelector("#profile-room-count");
  const recentRoomsList = document.querySelector("#recent-rooms-list");
  const recentRoomsEmpty = document.querySelector("#recent-rooms-empty");

  let currentProfile = null;

  async function loadProfile() {
    if (loading) loading.hidden = false;
    if (container) container.hidden = true;

    try {
      const response = await fetch("/api/profile/summary", { credentials: "same-origin" });

      if (!response.ok) {
        window.location.href = "/";
        return;
      }

      const data = await response.json();
      currentProfile = data;

      renderProfile(data);

      if (loading) loading.hidden = true;
      if (container) container.hidden = false;
    } catch (error) {
      console.error("Error loading profile:", error);
      window.location.href = "/";
    }
  }

  function renderProfile(data) {
    const user = data.user || {};
    const displayName = user.nickname || user.email || "Player";

    if (profileTitle) profileTitle.textContent = displayName;
    if (profileAvatar) profileAvatar.textContent = initialsFor(displayName);
    if (emailDisplay) emailDisplay.textContent = user.email || "";
    if (userIdDisplay) userIdDisplay.textContent = user.id ? `#${user.id}` : "";
    if (nicknameInput) nicknameInput.value = user.nickname || "";
    if (memberSince) {
      memberSince.textContent = user.created_at
        ? `Member since ${formatDate(user.created_at)}`
        : "Member profile";
    }

    renderStats(data.stats || {}, data.resultStats || {});
    renderRoomSection({
      rooms: data.activeRooms || [],
      countElement: activeRoomCount,
      listElement: activeRoomsList,
      emptyElement: activeRoomsEmpty,
      emptyLabel: "active room",
    });
    renderRecentRooms(data.recentRooms || []);
  }

  function renderStats(stats, resultStats) {
    setText(statTotal, stats.totalGames || 0);
    setText(statCompleted, stats.activeGames || stats.completedGames || 0);
    setText(statReady, stats.readyGames || 0);
    setText(statHosted, stats.hostedGames || 0);
    setText(statJoined, stats.joinedGames || 0);
    setText(statWaiting, stats.waitingGames || 0);
    setText(statCancelled, stats.cancelledGames || 0);
    setText(statResultGames, resultStats.resultGames || 0);
    setText(statWins, resultStats.wins || 0);
    setText(statLosses, resultStats.losses || 0);
    setText(statDraws, resultStats.draws || 0);
    setText(statWinRate, `${resultStats.winRate || 0}%`);
    setText(statTotalScore, resultStats.totalScore || 0);
    setText(statBestScore, resultStats.bestScore || 0);
    setText(statAverageScore, resultStats.averageScore || 0);
    setText(statGin, resultStats.ginCount || 0);
    setText(statKnock, resultStats.knockCount || 0);
    setText(heroWinRate, `${resultStats.winRate || 0}%`);
    setText(heroWins, resultStats.wins || 0);
    setText(heroScore, resultStats.totalScore || 0);
    if (lastRoom) {
      lastRoom.textContent = stats.lastRoomAt
        ? `Last room activity: ${formatDate(stats.lastRoomAt)}`
        : "No game room activity yet.";
    }
  }

  function renderRecentRooms(rooms) {
    renderRoomSection({
      rooms,
      countElement: roomCount,
      listElement: recentRoomsList,
      emptyElement: recentRoomsEmpty,
      emptyLabel: "room",
    });
  }

  function renderRoomSection({ rooms, countElement, listElement, emptyElement, emptyLabel }) {
    if (countElement) {
      const label = rooms.length === 1 ? emptyLabel : `${emptyLabel}s`;
      countElement.textContent = `${rooms.length} ${label}`;
    }
    if (!listElement) return;

    listElement.replaceChildren();
    if (!rooms.length) {
      if (emptyElement) emptyElement.hidden = false;
      return;
    }

    if (emptyElement) emptyElement.hidden = true;

    for (const room of rooms) {
      listElement.appendChild(buildRoomItem(room));
    }
  }

  function buildRoomItem(room) {
    const item = document.createElement("article");
    item.className = "profile-room";

    const title = document.createElement("div");
    title.className = "profile-room-title";
    const id = document.createElement("strong");
    id.textContent = room.id;
    const badge = document.createElement("span");
    badge.className = `profile-status profile-status-${room.status}`;
    badge.textContent = formatStatus(room.status);
    title.append(id, badge);

    const meta = document.createElement("p");
    const playerCount = room.playerCount || (room.players || []).length;
    meta.textContent = `${room.role || "Player"} · ${playerCount}/${room.capacity || 4} players · Created ${formatDate(room.createdAt)}`;

    const timing = document.createElement("p");
    timing.textContent = room.startedAt
      ? `Started ${formatDate(room.startedAt)}`
      : room.matchedAt
        ? `Matched ${formatDate(room.matchedAt)}`
        : "Not started yet";

    const players = document.createElement("p");
    players.className = "profile-room-players";
    players.textContent = `Players: ${(room.players || []).map((player) => player.label).join(", ")}`;

    item.append(title, meta, timing, players);
    return item;
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

      const data = await response.json();
      if (currentProfile) {
        currentProfile.user = data;
        renderProfile(currentProfile);
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

  function setText(element, value) {
    if (element) element.textContent = String(value);
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown date";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }

  function formatStatus(status) {
    const labels = {
      waiting: "Waiting",
      waiting_to_start: "Ready",
      completed: "In progress",
      cancelled: "Cancelled",
    };
    return labels[status] || status || "Unknown";
  }

  function initialsFor(value) {
    return String(value)
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "GR";
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
