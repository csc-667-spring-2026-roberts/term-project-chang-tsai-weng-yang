// public/js/chat.js
// Handles in-game chat functionality
(() => {
  // DOM elements
  const chatPanel = document.querySelector("#chat-panel");
  const chatMessages = document.querySelector("#chat-messages");
  const chatInput = document.querySelector("#chat-input");
  const chatSend = document.querySelector("#chat-send");
  const chatToggle = document.querySelector("#chat-toggle");
  const chatClose = document.querySelector("#chat-close");
  const chatLauncher = document.querySelector("#chat-launcher");
  const chatLauncherUnread = document.querySelector("#chat-launcher-unread");
  const chatRoomLabel = document.querySelector("#chat-room-label");
  const chatStatus = document.querySelector("#chat-status");
  const chatUnread = document.querySelector("#chat-unread");
  const chatError = document.querySelector("#chat-error");
  const chatCount = document.querySelector("#chat-count");

  let roomId = null;
  let currentUserId = null;
  let isMinimized = false;
  let isClosed = false;
  let unreadCount = 0;
  let controlsBound = false;
  const renderedMessageIds = new Set();

  // Helper functions for localStorage persistence
  function saveChatState() {
    localStorage.setItem("chatState", JSON.stringify({
      isMinimized,
      isClosed
    }));
  }

  function restoreChatState() {
    try {
      const stored = localStorage.getItem("chatState");
      if (stored) {
        const state = JSON.parse(stored);
        isMinimized = state.isMinimized || false;
        isClosed = state.isClosed || false;
        return true;
      }
    } catch (e) {
      console.error("Error restoring chat state:", e);
    }
    return false;
  }

  function applyChatState() {
    if (!chatPanel) return;

    if (isClosed) {
      chatPanel.hidden = true;
      if (chatLauncher) chatLauncher.hidden = false;
    } else {
      chatPanel.hidden = false;
      if (chatLauncher) chatLauncher.hidden = true;
      
      if (isMinimized) {
        chatPanel.classList.add("minimized");
        if (chatToggle) {
          chatToggle.textContent = "+";
          chatToggle.setAttribute("aria-expanded", "false");
        }
      } else {
        chatPanel.classList.remove("minimized");
        if (chatToggle) {
          chatToggle.textContent = "−";
          chatToggle.setAttribute("aria-expanded", "true");
        }
      }
    }
  }

  setIdleState();
  bindChatControls();

  // Event to initialize chat when game starts
  window.addEventListener("game:start", (event) => {
    const session = event.detail;
    roomId = session.roomId;
    initChat(session);
  });

  // Event to update current user ID
  window.addEventListener("game:chat:userId", (event) => {
    currentUserId = event.detail.userId;
    updateMessageOwnership();
  });

  async function initChat(session) {
    roomId = session.roomId;
    currentUserId = session.playerId || currentUserId;
    
    if (!chatPanel) {
      console.error("Chat panel not found");
      return;
    }

    // Show chat panel when game starts
    chatPanel.hidden = false;
    chatPanel.classList.remove("minimized");
    isMinimized = false;
    isClosed = false;
    unreadCount = 0;
    renderedMessageIds.clear();
    chatMessages.replaceChildren();
    setChatStatus("Loading messages...");
    setChatError("");
    updateUnreadBadge();
    updateCharacterCount();
    setChatEnabled(true);
    if (chatRoomLabel) {
      chatRoomLabel.textContent = `Room ${roomId}`;
    }
    if (chatToggle) {
      chatToggle.textContent = "−";
      chatToggle.setAttribute("aria-expanded", "true");
    }
    if (chatLauncher) {
      chatLauncher.hidden = true;
    }

    // Load chat history
    try {
      const response = await fetch(`/api/game/rooms/${roomId}/chat?limit=50`, {
        credentials: "same-origin",
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.messages && Array.isArray(data.messages)) {
          for (const msg of data.messages) {
            appendMessage(msg);
          }
          setChatStatus(data.messages.length ? "" : "No messages yet. Say hello when you're ready.");
          scrollChatToBottom();
        }
      } else {
        setChatStatus("Could not load chat history.");
      }
    } catch (error) {
      console.error("Error loading chat history:", error);
      setChatStatus("Could not load chat history.");
    }

    // Bind event listeners
    bindChatControls();

    // Restore previous chat state (minimized/closed) if it exists
    if (restoreChatState()) {
      applyChatState();
    }
  }

  function bindChatControls() {
    if (controlsBound) return;
    controlsBound = true;

    if (chatSend) {
      chatSend.addEventListener("click", sendMessage);
    }
    if (chatInput) {
      chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          sendMessage();
        }
      });
      chatInput.addEventListener("input", () => {
        updateCharacterCount();
        setChatError("");
      });
    }
    if (chatToggle) {
      chatToggle.addEventListener("click", toggleChat);
    }
    if (chatClose) {
      chatClose.addEventListener("click", closeChat);
    }
    if (chatLauncher) {
      chatLauncher.addEventListener("click", openChat);
    }
  }

  async function sendMessage() {
    if (!chatInput) return;
    if (!roomId) {
      setChatError("Join a room before sending a message.");
      return;
    }

    const message = chatInput.value.trim();
    if (message.length === 0) return;

    // Clear input immediately
    chatInput.value = "";
    updateCharacterCount();
    setChatError("");
    chatPanel?.classList.add("sending");
    chatSend.disabled = true;

    try {
      const response = await fetch(`/api/game/rooms/${roomId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error("Failed to send message:", error.message);
        chatInput.value = message;
        updateCharacterCount();
        setChatError(error.message || "Message could not be sent.");
      }
    } catch (error) {
      console.error("Error sending message:", error);
      chatInput.value = message;
      updateCharacterCount();
      setChatError("Network error. Message was not sent.");
    } finally {
      chatSend.disabled = false;
      chatPanel?.classList.remove("sending");
      chatInput.focus();
    }
  }

  function appendMessage(message) {
    if (!chatMessages) return;
    if (message.id && renderedMessageIds.has(message.id)) return;
    if (message.id) renderedMessageIds.add(message.id);

    setChatStatus("");

    const msgEl = document.createElement("div");
    msgEl.className = "chat-message";
    const senderId = message.userId || message.user_id;
    if (senderId) {
      msgEl.dataset.senderId = String(senderId);
    }
    if (isOwnMessage(message)) {
      msgEl.classList.add("own");
    }

    const metaEl = document.createElement("div");
    metaEl.className = "chat-message-meta";

    const userEl = document.createElement("span");
    userEl.className = "chat-message-user";
    userEl.textContent = isOwnMessage(message) ? "You" : message.nickname || "Player";

    const timeEl = document.createElement("span");
    timeEl.className = "chat-message-time";
    const time = new Date(message.created_at || message.timestamp);
    timeEl.textContent = Number.isNaN(time.getTime())
      ? ""
      : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const textEl = document.createElement("div");
    textEl.className = "chat-message-text";
    textEl.textContent = message.message;

    metaEl.appendChild(userEl);
    metaEl.appendChild(timeEl);
    msgEl.appendChild(metaEl);
    msgEl.appendChild(textEl);

    chatMessages.appendChild(msgEl);
    scrollChatToBottom();

    if ((isMinimized || isClosed) && !isOwnMessage(message)) {
      unreadCount += 1;
      updateUnreadBadge();
    }
  }

  function scrollChatToBottom() {
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  function toggleChat() {
    if (!chatPanel) return;
    
    if (isMinimized) {
      chatToggle.textContent = "−";
      chatToggle.setAttribute("aria-expanded", "true");
      chatPanel.classList.remove("minimized");
      unreadCount = 0;
      updateUnreadBadge();
      isMinimized = false;
      scrollChatToBottom();
      chatInput?.focus();
    } else {
      chatToggle.textContent = "+";
      chatToggle.setAttribute("aria-expanded", "false");
      chatPanel.classList.add("minimized");
      isMinimized = true;
    }
    saveChatState();
  }

  function closeChat() {
    if (!chatPanel || !chatLauncher) return;

    chatPanel.hidden = true;
    chatLauncher.hidden = false;
    isClosed = true;
    isMinimized = false;
    updateUnreadBadge();
    saveChatState();
  }

  function openChat() {
    if (!chatPanel || !chatLauncher) return;

    chatPanel.hidden = false;
    chatLauncher.hidden = true;
    chatPanel.classList.remove("minimized");
    isClosed = false;
    isMinimized = false;
    unreadCount = 0;
    updateUnreadBadge();
    if (chatToggle) {
      chatToggle.textContent = "−";
      chatToggle.setAttribute("aria-expanded", "true");
    }
    scrollChatToBottom();
    if (roomId) {
      chatInput?.focus();
    }
    saveChatState();
  }

  function isOwnMessage(message) {
    const senderId = message.userId || message.user_id;
    return Boolean(currentUserId && senderId && Number(senderId) === Number(currentUserId));
  }

  function updateMessageOwnership() {
    if (!chatMessages || !currentUserId) return;

    for (const msgEl of chatMessages.querySelectorAll(".chat-message")) {
      const isOwn = Number(msgEl.dataset.senderId) === Number(currentUserId);
      msgEl.classList.toggle("own", isOwn);
      const userEl = msgEl.querySelector(".chat-message-user");
      if (isOwn && userEl) {
        userEl.textContent = "You";
      }
    }
  }

  function updateUnreadBadge() {
    const unreadLabel = String(Math.min(unreadCount, 99));

    if (chatUnread) {
      chatUnread.hidden = unreadCount === 0;
      chatUnread.textContent = unreadLabel;
    }
    if (chatLauncherUnread) {
      chatLauncherUnread.hidden = unreadCount === 0;
      chatLauncherUnread.textContent = unreadLabel;
    }
  }

  function updateCharacterCount() {
    if (!chatInput || !chatCount) return;

    const length = chatInput.value.length;
    chatCount.textContent = `${length}/500`;
    chatCount.classList.toggle("near-limit", length > 440);
  }

  function setChatStatus(message) {
    if (!chatStatus) return;

    chatStatus.textContent = message;
    chatStatus.hidden = message.length === 0;
  }

  function setChatError(message) {
    if (!chatError) return;

    chatError.textContent = message;
  }

  function setChatEnabled(enabled) {
    if (chatInput) {
      chatInput.disabled = !enabled;
      chatInput.placeholder = enabled ? "Message the room" : "Join a room to chat";
    }
    if (chatSend) {
      chatSend.disabled = !enabled;
    }
  }

  function setIdleState() {
    if (chatPanel) {
      chatPanel.hidden = true;
      chatPanel.classList.remove("minimized", "sending");
    }
    if (chatLauncher) {
      chatLauncher.hidden = true;
    }
    if (chatRoomLabel) {
      chatRoomLabel.textContent = "No active room";
    }
    if (chatMessages) {
      chatMessages.replaceChildren();
    }
    if (chatToggle) {
      chatToggle.textContent = "−";
      chatToggle.setAttribute("aria-expanded", "true");
    }
    isMinimized = false;
    isClosed = false;
    roomId = null;
    unreadCount = 0;
    renderedMessageIds.clear();
    setChatEnabled(false);
    setChatStatus("Start or join a game room to chat with other players.");
    setChatError("");
    updateUnreadBadge();
    updateCharacterCount();
    // Clear persisted state when game ends
    localStorage.removeItem("chatState");
  }

  // Export function for game-init.js to call
  window.chatReceiveMessage = function(message) {
    appendMessage(message);
  };

  // Export function for game-init.js to use for hiding chat
  window.chatHide = function() {
    setIdleState();
  };
})();
