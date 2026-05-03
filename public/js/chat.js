// public/js/chat.js
// Handles in-game chat functionality
(() => {
  // DOM elements
  const chatPanel = document.querySelector("#chat-panel");
  const chatMessages = document.querySelector("#chat-messages");
  const chatInput = document.querySelector("#chat-input");
  const chatSend = document.querySelector("#chat-send");
  const chatToggle = document.querySelector("#chat-toggle");

  let roomId = null;
  let currentUserId = null;
  let isMinimized = false;

  // Event to initialize chat when game starts
  window.addEventListener("game:start", (event) => {
    const session = event.detail;
    roomId = session.roomId;
    initChat(session);
  });

  // Event to update current user ID
  window.addEventListener("game:chat:userId", (event) => {
    currentUserId = event.detail.userId;
  });

  async function initChat(session) {
    roomId = session.roomId;
    
    if (!chatPanel) {
      console.error("Chat panel not found");
      return;
    }

    // Show chat panel when game starts
    chatPanel.hidden = false;
    chatMessages.replaceChildren();

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
          scrollChatToBottom();
        }
      }
    } catch (error) {
      console.error("Error loading chat history:", error);
    }

    // Bind event listeners
    bindChatControls();
  }

  function bindChatControls() {
    if (chatSend) {
      chatSend.addEventListener("click", sendMessage);
    }
    if (chatInput) {
      chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          sendMessage();
        }
      });
    }
    if (chatToggle) {
      chatToggle.addEventListener("click", toggleChat);
    }
  }

  async function sendMessage() {
    if (!chatInput || !roomId) return;

    const message = chatInput.value.trim();
    if (message.length === 0) return;

    // Clear input immediately
    chatInput.value = "";
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
      }
    } catch (error) {
      console.error("Error sending message:", error);
      chatInput.value = message;
    } finally {
      chatSend.disabled = false;
      chatInput.focus();
    }
  }

  function appendMessage(message) {
    if (!chatMessages) return;

    const msgEl = document.createElement("div");
    msgEl.className = "chat-message";

    const userEl = document.createElement("div");
    userEl.className = "chat-message-user";
    userEl.textContent = message.nickname || "Anonymous";

    const textEl = document.createElement("div");
    textEl.className = "chat-message-text";
    textEl.textContent = message.message;

    const timeEl = document.createElement("div");
    timeEl.className = "chat-message-time";
    const time = new Date(message.created_at || message.timestamp);
    timeEl.textContent = time.toLocaleTimeString([], { 
      hour: "2-digit", 
      minute: "2-digit" 
    });

    msgEl.appendChild(userEl);
    msgEl.appendChild(textEl);
    msgEl.appendChild(timeEl);

    chatMessages.appendChild(msgEl);
    scrollChatToBottom();
  }

  function scrollChatToBottom() {
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  function toggleChat() {
    if (!chatPanel) return;
    
    if (isMinimized) {
      // Expand - slide up
      chatPanel.style.height = "600px";
      chatMessages.style.display = "flex";
      document.querySelector(".chat-input-wrapper").style.display = "flex";
      chatToggle.textContent = "−";
      chatPanel.classList.remove("minimized");
      isMinimized = false;
    } else {
      // Minimize - slide down
      chatPanel.style.height = "44px";
      chatMessages.style.display = "none";
      document.querySelector(".chat-input-wrapper").style.display = "none";
      chatToggle.textContent = "+";
      chatPanel.classList.add("minimized");
      isMinimized = true;
    }
  }

  // Export function for game-init.js to call
  window.chatReceiveMessage = function(message) {
    appendMessage(message);
  };

  // Export function for game-init.js to use for hiding chat
  window.chatHide = function() {
    if (chatPanel) {
      chatPanel.hidden = true;
    }
  };
})();
