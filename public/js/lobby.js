// Simple lobby UI client for socket.io 
document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // Mobile detection utility
  function isMobileDevice() {
    return window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  // Initialize user's selected emojis from server
  const availableEmojis = [
    { id: 'wave', icon: '👋' },
    { id: 'thumbsup', icon: '👍' },
    { id: 'party', icon: '🎉' },
    { id: 'fire', icon: '🔥' },
    { id: 'hearteyes', icon: '😍' },
    { id: 'crown', icon: '👑' },
    { id: 'cool', icon: '😎' },
    { id: 'partysmith', icon: '🎊', image: 'partySmith.png' },
    { id: 'cowboy', icon: '🤠' },
    { id: 'rocket', icon: '🚀' },
    { id: 'star', icon: '⭐' },
    { id: 'disasmithed', icon: '😵', image: 'disasmithed.png' }
  ];

  let selectedEmojis = [];
  try {
    const emotesData = document.body.getAttribute('data-selected-emotes') || '["wave","thumbsup","party","fire"]';
    selectedEmojis = JSON.parse(emotesData);
    if (!Array.isArray(selectedEmojis) || selectedEmojis.length !== 4) {
      selectedEmojis = ['wave', 'thumbsup', 'party', 'fire'];
    }
  } catch (e) {
    console.error('Error parsing selected emotes:', e);
    selectedEmojis = ['wave', 'thumbsup', 'party', 'fire'];
  }

  // Initialize emoji menu items
  function initEmojiMenu() {
    const menuItems = document.querySelectorAll('.emoji-menu-item');
    selectedEmojis.forEach((emojiId, index) => {
      const emoji = availableEmojis.find(e => e.id === emojiId);
      if (emoji && menuItems[index]) {
        if (emoji.image) {
          menuItems[index].innerHTML = `<img src="/img/${emoji.image}" alt="${emoji.id}" style="width: 40px; height: 40px; border-radius: 5px;">`;
        } else {
          menuItems[index].textContent = emoji.icon;
        }
        menuItems[index].onclick = () => sendEmojiReaction(emojiId, emoji.icon, emoji.image);
      }
    });
  }

  // Initialize emoji menu on page load
  setTimeout(initEmojiMenu, 100);

  // Toggle emoji menu visibility
  window.toggleEmojiMenu = function() {
    const menu = document.getElementById('emojiMenu');
    if (menu.style.display === 'none') {
      menu.style.display = 'flex';
    } else {
      menu.style.display = 'none';
    }
  };

  // Close emoji menu when clicking outside
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('emojiMenu');
    const btn = document.getElementById('emojiReactionBtn');
    if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
      menu.style.display = 'none';
    }
  });

  // Send emoji reaction
  function sendEmojiReaction(emojiId, emojiIcon, emojiImage) {
    if (currentGameId) {
      socket.emit('emojiReaction', { 
        gameId: currentGameId, 
        playerName: window.CURRENT_USER,
        emojiId, 
        emojiIcon, 
        emojiImage 
      });
      // Close menu after sending
      const menu = document.getElementById('emojiMenu');
      if (menu) menu.style.display = 'none';
    }
  }

  // Display emoji reaction
  function displayEmojiReaction(playerName, emojiIcon, emojiImage) {
    // Optionally disable reactions on mobile (comment this out if you want to keep reactions on mobile)
    if (isMobileDevice()) {
      console.log('Emoji reactions disabled on mobile');
      return;
    }
    const reactionsArea = document.getElementById('emojiReactionsArea');
    const reaction = document.createElement('div');
    reaction.className = 'emoji-reaction';
    
    if (emojiImage) {
      reaction.innerHTML = `
        <img src="/img/${emojiImage}" alt="${playerName}" style="width: 50px; height: 50px; border-radius: 10px;">
        <span class="emoji-reaction-name">${playerName}</span>
      `;
    } else {
      reaction.innerHTML = `
        <span class="emoji-reaction-icon">${emojiIcon}</span>
        <span class="emoji-reaction-name">${playerName}</span>
      `;
    }
    
    reactionsArea.appendChild(reaction);
    
    // Remove after animation
    setTimeout(() => {
      reaction.remove();
    }, 3000);
  }

  // Listen for emoji reactions from server
  socket.on('emojiReaction', ({ playerName, emojiIcon, emojiImage }) => {
    displayEmojiReaction(playerName, emojiIcon, emojiImage);
  });

  // Badge to emoji mapping
  function getBadgeEmoji(badge) {
    if (!badge || badge === 'none') return '';
    const badgeMap = {
      'bronze': '🥉',
      'silver': '🥈',
      'gold': '🥇',
      'trophy': '🏆',
      'diamond': '💎'
    };
    return badgeMap[badge] || badge;
  }

  const lobbyListEl = document.getElementById('lobbyList');
  const createBtn = document.getElementById('createLobbyBtn');
  const createName = document.getElementById('createLobbyName');
  const createMax = document.getElementById('createMaxPlayers');
  const createPrivate = document.getElementById('createPrivateLobby');

  const joinLobbyCode = document.getElementById('joinLobbyCode');
  const joinByCodeBtn = document.getElementById('joinByCodeBtn');

  const currentRoomEl = document.getElementById('currentRoom');
  const currentRoomTitle = document.getElementById('currentRoomTitle');
  const currentRoomInfo = document.getElementById('currentRoomInfo');
  const roomPlayerList = document.getElementById('roomPlayerList');
  const roomControls = document.getElementById('roomControls');
  const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');

  const lobbiesContainer = document.getElementById('lobbiesContainer');
  const createLobbySection = document.getElementById('createLobby');
  const joinByCodeSection = document.getElementById('joinByCode');

  let currentGameId = null;
  let currentPlayerId = null;
  let currentOwnerId = null;
  let lastPlayers = [];
  let currentLobbyName = null;
  let hasPaid = false;
  let pendingAction = null; // Store pending action after payment

  // When socket connects, record our socket id as our current player id
  socket.on('connect', () => {
    currentPlayerId = socket.id;
  });

  // Receive payment status from server
  socket.on('paymentStatus', ({ hasPaid: paid }) => {
    hasPaid = paid;
    updateUIForPaymentStatus();
  });

  // Handle payment requirement error
  socket.on('createLobbyError', ({ reason, requiresPayment }) => {
    if (requiresPayment) {
      showPaymentModal();
    } else {
      alert('Unable to create lobby: ' + reason);
    }
  });

  function renderLobbyList(lobbies) {
    if (!Array.isArray(lobbies) || lobbies.length === 0) {
      lobbyListEl.innerHTML = '<div class="empty-state"><div class="emoji"></div><div>No lobbies available. Create one!</div></div>';
      return;
    }
    lobbyListEl.innerHTML = '';
    lobbies.forEach(l => {
      const div = document.createElement('div');
      div.className = 'lobby-item fade-in';
      div.innerHTML = `
        <div class="lobby-name">${escapeHtml(l.lobbyName)}</div>
        <div class="lobby-info">
          <span class="player-count">${l.playerCount}/${l.maxPlayers} Players</span>
          ${l.isPrivate ? '<span class="private-badge"> Private</span>' : ''}
        </div>
      `;
      div.onclick = () => {
        if (!hasPaid) {
          pendingAction = { type: 'joinLobby', gameId: l.gameId };
          showPaymentModal();
        } else {
          window.location.href = '/room/' + encodeURIComponent(l.gameId);
        }
      };
      lobbyListEl.appendChild(div);
    });
  }

  function renderPlayers(players) {
    lastPlayers = Array.isArray(players) ? players : [];
    roomPlayerList.innerHTML = '';
    players.forEach(p => {
      const pDiv = document.createElement('div');
      pDiv.className = 'player-tag' + (p.id === currentOwnerId ? ' host' : '');

      // Add badge if player has one
      if (p.selectedBadge && p.selectedBadge !== 'none') {
        const badgeEmoji = getBadgeEmoji(p.selectedBadge);
        if (badgeEmoji) {
          const badgeSpan = document.createElement('span');
          badgeSpan.className = 'lobby-player-badge';
          badgeSpan.textContent = badgeEmoji;
          pDiv.appendChild(badgeSpan);
        }
      }

      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name;
      if (p.selectedTitleColor) {
        nameSpan.style.color = p.selectedTitleColor;
      }
      pDiv.appendChild(nameSpan);

      if (p.id === currentOwnerId) {
        const hostBadge = document.createElement('span');
        hostBadge.className = 'host-badge';
        hostBadge.textContent = ' Host';
        pDiv.appendChild(hostBadge);
      }

      const readySpan = document.createElement('span');
      readySpan.className = 'ready-status ' + (p.ready ? 'ready' : 'not-ready');
      pDiv.appendChild(readySpan);

      // If this is the current user, show a toggle button
      if (p.id === currentPlayerId) {
        const readyBtn = document.createElement('button');
        readyBtn.className = 'ready-btn';
        readyBtn.textContent = p.ready ? 'Unready' : 'Ready';
        readyBtn.onclick = (e) => {
          e.stopPropagation();
          socket.emit('setReady', { gameId: currentGameId, ready: !p.ready });
        };
        pDiv.appendChild(readyBtn);
      }

      roomPlayerList.appendChild(pDiv);
    });

    // update room info (players count) when player list changes
    if (currentGameId) {
      const max = (createMax && createMax.value) ? createMax.value : '8';
      currentRoomInfo.textContent = `Players: ${players.length}/${max}`;
    }
  }

  function showCurrentRoom(meta = {}) {
    // Hide lobby list and show current room
    if (lobbiesContainer) lobbiesContainer.style.display = 'none';
    if (createLobbySection) createLobbySection.style.display = 'none';
    if (joinByCodeSection) joinByCodeSection.style.display = 'none';

    // Show emoji reaction button when in room
    const emojiBtn = document.getElementById('emojiReactionBtn');
    if (emojiBtn) emojiBtn.style.display = 'flex';

    currentRoomEl.style.display = 'block';
    currentRoomEl.classList.add('active');
    currentGameId = meta.gameId || currentGameId;
    currentRoomTitle.textContent = meta.lobbyName || `Room ${currentGameId ? currentGameId.slice(0, 6) : ''}`;

    if (typeof meta.lobbyName !== 'undefined' && meta.lobbyName !== null) {
      currentLobbyName = meta.lobbyName;
    }
    currentRoomTitle.textContent = (currentLobbyName || `Room ${currentGameId ? currentGameId.slice(0, 6) : ''}`);
    // Update info display if available
    if (typeof meta.playerCount !== 'undefined' || typeof meta.maxPlayers !== 'undefined') {
      const pc = meta.playerCount != null ? meta.playerCount : '0';
      const mp = meta.maxPlayers != null ? meta.maxPlayers : (createMax ? createMax.value : '8');
      currentRoomInfo.innerHTML = `<span class="info-item"> ${escapeHtml(meta.ownerName || 'Host')}</span><span class="info-item">👥 ${pc}/${mp} Players</span>`;
    } else {
      // leave previous info if we don't have new values
    }

    currentOwnerId = meta.ownerId || currentOwnerId;
    roomControls.innerHTML = '';

    if (currentPlayerId && currentOwnerId && currentPlayerId === currentOwnerId) {
      const players = Array.isArray(lastPlayers) ? lastPlayers : [];
      const allReady = players.length > 0 && players.every(p => !!p.ready);
      const startBtn = document.createElement('button');
      startBtn.className = 'start-btn';
      startBtn.textContent = 'Start Game';
      startBtn.disabled = !allReady;
      startBtn.onclick = () => {
        const handSize = 7;
        socket.emit('startGame', { gameId: currentGameId, handSize });
      };
      roomControls.appendChild(startBtn);

      if (!allReady) {
        const note = document.createElement('div');
        note.className = 'waiting-note';
        note.textContent = 'Waiting for all players to be ready...';
        roomControls.appendChild(note);
      }
    }

    // Smooth scroll the room into view
    try {
      currentRoomEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { /* ignore if not supported */ }
  }

  // escape helper
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": "&#39;" }[t]));
  }

  socket.on('startFailed', ({ reason }) => {
    alert('Unable to start game: ' + reason || 'ALL players must be ready.');
  });

  // receive lobby list
  socket.on('lobbyList', (list) => {
    renderLobbyList(list);
  });

  // joined a lobby
  socket.on('joined', ({ playerId, gameId, lobbyName }) => {
    currentPlayerId = playerId || currentPlayerId;
    currentGameId = gameId || currentGameId;
    // request current lobby list to update UI
    socket.emit('getLobbies');
    // show current room area
    showCurrentRoom({ gameId, lobbyName: lobbyName || `Room ${gameId ? gameId.slice(0, 6) : ''}` });
  });

  // player list update for the room
  socket.on('playerList', (players) => {
    renderPlayers(players);
    // After rendering players, update room controls to show/hide start button
    if (currentGameId && currentOwnerId) {
      showCurrentRoom({ gameId: currentGameId, ownerId: currentOwnerId });
    }
  });

  socket.on('ownerChanged', ({ ownerId, ownerName }) => {
    currentOwnerId = ownerId;
    // update lobby list display for other viewers
    socket.emit('getLobbies');
  });

  // server may emit different error names; handle both older and newer names
  socket.on('joinFailed', ({ reason }) => {
    alert('Unable to join: ' + reason);
  });
  socket.on('lobbyJoinError', ({ reason }) => {
    alert('Unable to join: ' + reason);
  });

  // when a game started navigate to /game
  socket.on('gameStarted', ({ currentPlayerId: cp, players }) => {
    window.location.href = '/game?gameId=' + encodeURIComponent(currentGameId);
  });
  // redirect/enter room when server confirms lobby created
  socket.on('lobbyCreated', ({ gameId, lobbyName, isPrivate = false, joinCode = null }) => {
    // Keep the current socket alive: update URL and show the in-page room
    currentGameId = gameId;
    try {
      history.replaceState(null, '', '/room/' + encodeURIComponent(gameId));
    } catch (e) { /* ignore */ }
    showCurrentRoom({ gameId, lobbyName: lobbyName || `Room ${gameId.slice(0, 6)}` });
    // If the server returned a join code (private lobby), show it to the creator in controls
    if (isPrivate && joinCode) {
      roomControls.innerHTML = '';
      const codeDiv = document.createElement('div');
      codeDiv.textContent = 'Private lobby — join code: ' + joinCode;
      roomControls.appendChild(codeDiv);
    }
    // Ask server for fresh lobby list for other viewers
    socket.emit('getLobbies');
  });

  // create lobby
  createBtn.addEventListener('click', () => {
    if (!hasPaid) {
      pendingAction = { type: 'createLobby' };
      showPaymentModal();
      return;
    }
    createLobbyNow();
  });

  // Function to create lobby
  function createLobbyNow() {
    const name = createName.value || `${window.CURRENT_USER || 'Host'}'s Lobby`;
    const maxPlayers = parseInt(createMax.value, 10) || 8;
    const isPrivate = !!(createPrivate && createPrivate.checked);
    socket.emit('createLobby', { lobbyName: name, maxPlayers, playerName: window.CURRENT_USER || 'Host', isPrivate });
  }

  // leave lobby
  leaveLobbyBtn.addEventListener('click', () => {
    if (!currentGameId) return;
    socket.emit('leaveLobby', { gameId: currentGameId });
    currentGameId = null;
    currentPlayerId = socket.id || null;
    currentOwnerId = null;
    currentRoomEl.style.display = 'none';
    
    // Hide emoji reaction button when leaving room
    const emojiBtn = document.getElementById('emojiReactionBtn');
    if (emojiBtn) emojiBtn.style.display = 'none';
    
    // restore lobby UI
    if (lobbiesContainer) lobbiesContainer.style.display = 'block';
    if (createLobbySection) createLobbySection.style.display = 'block';
    if (joinByCodeSection) joinByCodeSection.style.display = 'block';
    // refresh
    socket.emit('getLobbies');
  });

  // join by code
  if (joinByCodeBtn && joinLobbyCode) {
    joinByCodeBtn.addEventListener('click', () => {
      const code = (joinLobbyCode.value || '').trim().toUpperCase();
      if (!code) {
        alert('Please enter a lobby code');
        return;
      }
      if (!hasPaid) {
        pendingAction = { type: 'joinByCode', code: code };
        showPaymentModal();
        return;
      }
      socket.emit('joinByCode', { joinCode: code, playerName: window.CURRENT_USER || 'Player' });
    });
  }

  // Handle join by code response
  socket.on('joinByCodeSuccess', ({ gameId, lobbyName, joinCode }) => {
    currentGameId = gameId;
    // Pass the join code in URL so room.js can use it
    const code = (joinLobbyCode && joinLobbyCode.value) ? joinLobbyCode.value.trim().toUpperCase() : '';
    window.location.href = '/room/' + encodeURIComponent(gameId) + (code ? '?code=' + encodeURIComponent(code) : '');
  });

  socket.on('joinByCodeError', ({ reason }) => {
    alert('Unable to join: ' + (reason || 'Invalid code'));
  });

  // Request lobby list periodically (only when not currently in a room)
  setInterval(() => {
    if (!currentGameId) {
      socket.emit('getLobbies');
    }
  }, 5000);

  // Payment modal functions
  window.showPaymentModal = function () {
    const modal = document.getElementById('paymentModal');
    if (modal) modal.style.display = 'block';
  };

  window.hidePaymentModal = function () {
    const modal = document.getElementById('paymentModal');
    if (modal) modal.style.display = 'none';
  };

  // Update UI based on payment status
  function updateUIForPaymentStatus() {
    if (!hasPaid && createBtn) {
      createBtn.classList.add('payment-required');
      createBtn.title = 'Payment required to create lobbies';
    } else if (createBtn) {
      createBtn.classList.remove('payment-required');
      createBtn.title = '';
    }
  }

  // Listen for payment success
  window.addEventListener('paymentSuccess', () => {
    // Request fresh payment status from server via socket
    socket.emit('refreshPaymentStatus');
    // Also update local state immediately for responsiveness
    hasPaid = true;
    updateUIForPaymentStatus();
    hidePaymentModal();

    // Execute pending action if there is one
    if (pendingAction) {
      if (pendingAction.type === 'createLobby') {
        createLobbyNow();
      } else if (pendingAction.type === 'joinLobby') {
        window.location.href = '/room/' + encodeURIComponent(pendingAction.gameId);
      } else if (pendingAction.type === 'joinByCode') {
        socket.emit('joinByCode', { joinCode: pendingAction.code, playerName: window.CURRENT_USER || 'Player' });
      }
      pendingAction = null; // Clear pending action
    }
  });

  window.addEventListener('hidePaymentModal', () => {
    hidePaymentModal();
  });
});