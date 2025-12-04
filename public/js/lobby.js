// Simple lobby UI client for socket.io (Thanks copilot)
document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  const lobbyListEl = document.getElementById('lobbyList');
  const createBtn = document.getElementById('createLobbyBtn');
  const createName = document.getElementById('createLobbyName');
  const createMax = document.getElementById('createMaxPlayers');

  const currentRoomEl = document.getElementById('currentRoom');
  const currentRoomTitle = document.getElementById('currentRoomTitle');
  const currentRoomInfo = document.getElementById('currentRoomInfo');
  const roomPlayerList = document.getElementById('roomPlayerList');
  const roomControls = document.getElementById('roomControls');
  const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');

  const lobbiesContainer = document.getElementById('lobbiesContainer');
  const createLobbySection = document.getElementById('createLobby');

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
      lobbyListEl.innerHTML = '<div>No lobbies available</div>';
      return;
    }
    lobbyListEl.innerHTML = '';
    lobbies.forEach(l => {
      const div = document.createElement('div');
      div.className = 'lobbyEntry';
      div.innerHTML = `
        <strong>${escapeHtml(l.lobbyName)}</strong>
        <div>Owner: ${escapeHtml(l.ownerName)}</div>
        <div>Players: ${l.playerCount}/${l.maxPlayers}</div>
        <div>Status: ${escapeHtml(l.status)}</div>
      `;
      const joinBtn = document.createElement('button');
      joinBtn.textContent = 'Join';
      joinBtn.onclick = () => { window.location.href = '/room/' + encodeURIComponent(l.gameId);};
      div.appendChild(joinBtn);
      lobbyListEl.appendChild(div);
    });
  }

function renderPlayers(players) {
  lastPlayers = Array.isArray(players) ? players : [];
  roomPlayerList.innerHTML = '<h3>Players</h3>';
  players.forEach(p => {
    const pDiv = document.createElement('div');
    const ownerLabel = (p.id === currentOwnerId) ? ' (Owner)' : '';
    const readyLabel = p.ready ? ' ✅ Ready' : ' ⏳ Not Ready';
    pDiv.textContent = p.name + ownerLabel + readyLabel;

    // If this is the current user, show a toggle button
    if (p.id === currentPlayerId) {
      const readyBtn = document.createElement('button');
      readyBtn.textContent = p.ready ? 'Unready' : 'Ready';
      readyBtn.onclick = () => {
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

    currentRoomEl.style.display = 'block';
    currentGameId = meta.gameId || currentGameId;
    currentRoomTitle.textContent = meta.lobbyName || `Room ${currentGameId ? currentGameId.slice(0,6) : ''}`;

    if (typeof meta.lobbyName !== 'undefined' && meta.lobbyName !== null) {
      currentLobbyName = meta.lobbyName;
    }
    currentRoomTitle.textContent = currentLobbyName || `Room ${currentGameId ? currentGameId.slice(0,6) : ''}`;
    // Update info display if available
    if (typeof meta.playerCount !== 'undefined' || typeof meta.maxPlayers !== 'undefined') {
      const pc = meta.playerCount != null ? meta.playerCount : '0';
      const mp = meta.maxPlayers != null ? meta.maxPlayers : (createMax ? createMax.value : '8');
      currentRoomInfo.innerHTML = `Owner: ${escapeHtml(meta.ownerName || 'Host')} | Players: ${pc}/${mp}`;
    } else {
      // leave previous info if we don't have new values
    }

    currentOwnerId = meta.ownerId || currentOwnerId;
    roomControls.innerHTML = '';

      if (currentPlayerId && currentOwnerId && currentPlayerId === currentOwnerId) {
        const players = Array.isArray(lastPlayers) ? lastPlayers : [];
        const allReady = players.length > 0 && players.every(p => !!p.ready);
        const startBtn = document.createElement('button');
        startBtn.textContent = 'Start Game';
        startBtn.disabled = !allReady;
        startBtn.onclick = () => {
          const handSize = 7;
          socket.emit('startGame', { gameId: currentGameId, handSize });
        };
        roomControls.appendChild(startBtn);

    if (!allReady) {
      const note = document.createElement('div');
      note.textContent = 'All players must be ready to start.';
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
  socket.on('lobbyCreated', ({ gameId, lobbyName }) => {
  // Keep the current socket alive: update URL and show the in-page room
  currentGameId = gameId;
  try {
    history.replaceState(null, '', '/room/' + encodeURIComponent(gameId));
  } catch (e) { /* ignore */ }
  showCurrentRoom({ gameId, lobbyName: lobbyName || `Room ${gameId.slice(0,6)}` });
  // Ask server for fresh lobby list for other viewers
  socket.emit('getLobbies');
});

  // create lobby
  createBtn.addEventListener('click', () => {
    const name = createName.value || `${window.CURRENT_USER || 'Host'}'s Lobby`;
    const maxPlayers = parseInt(createMax.value, 10) || 8;
    socket.emit('createLobby', { lobbyName: name, maxPlayers, playerName: window.CURRENT_USER || 'Host' });
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
    // refresh
    socket.emit('getLobbies');
  });

  // Request lobby list periodically (only when not currently in a room)
  setInterval(() => {
    if (!currentGameId) {
      socket.emit('getLobbies');
    }
  }, 5000);
});