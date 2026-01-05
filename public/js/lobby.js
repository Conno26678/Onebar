// Simple lobby UI client for socket.io 
document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

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

  // When socket connects, record our socket id as our current player id
  socket.on('connect', () => {
    currentPlayerId = socket.id;
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
      div.onclick = () => { window.location.href = '/room/' + encodeURIComponent(l.gameId);};
      lobbyListEl.appendChild(div);
    });
  }

function renderPlayers(players) {
  lastPlayers = Array.isArray(players) ? players : [];
  roomPlayerList.innerHTML = '';
  players.forEach(p => {
    const pDiv = document.createElement('div');
    pDiv.className = 'player-tag' + (p.id === currentOwnerId ? ' host' : '');
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name;
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

    currentRoomEl.style.display = 'block';
    currentRoomEl.classList.add('active');
    currentGameId = meta.gameId || currentGameId;
    currentRoomTitle.textContent = meta.lobbyName || `Room ${currentGameId ? currentGameId.slice(0,6) : ''}`;

    if (typeof meta.lobbyName !== 'undefined' && meta.lobbyName !== null) {
      currentLobbyName = meta.lobbyName;
    }
    currentRoomTitle.textContent = (currentLobbyName || `Room ${currentGameId ? currentGameId.slice(0,6) : ''}`);
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
    return String(s).replace(/[&<>"']/g, t => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[t]));
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
    showCurrentRoom({ gameId, lobbyName: lobbyName || `Room ${gameId ? gameId.slice(0,6) : ''}` });
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
  showCurrentRoom({ gameId, lobbyName: lobbyName || `Room ${gameId.slice(0,6)}` });
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
    const name = createName.value || `${window.CURRENT_USER || 'Host'}'s Lobby`;
    const maxPlayers = parseInt(createMax.value, 10) || 8;
    const isPrivate = !!(createPrivate && createPrivate.checked);
    socket.emit('createLobby', { lobbyName: name, maxPlayers, playerName: window.CURRENT_USER || 'Host', isPrivate });
  });

  // leave lobby
  leaveLobbyBtn.addEventListener('click', () => {
    if (!currentGameId) return;
    socket.emit('leaveLobby', { gameId: currentGameId });
    currentGameId = null;
    currentPlayerId = socket.id || null;
    currentOwnerId = null;
    currentRoomEl.style.display = 'none';
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
});