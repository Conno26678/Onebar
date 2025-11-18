// ...existing code...
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
      joinBtn.onclick = () => {
        socket.emit('joinLobby', { gameId: l.gameId, playerName: window.CURRENT_USER || 'Guest' });
      };
      div.appendChild(joinBtn);
      lobbyListEl.appendChild(div);
    });
  }

  function renderPlayers(players) {
    roomPlayerList.innerHTML = '<h3>Players</h3>';
    players.forEach(p => {
      const pDiv = document.createElement('div');
      pDiv.textContent = p.name + (p.id === currentOwnerId ? ' (Owner)' : '');
      roomPlayerList.appendChild(pDiv);
    });

    // update room info (players count) when player list changes
    if (currentGameId) {
      const max = (createMax && createMax.value) ? createMax.value : '8';
      currentRoomInfo.textContent = `Players: ${players.length}/${max}`;
    }
  }

  function showCurrentRoom(meta = {}) {
    // Hide lobby list and create UI to give the room full focus
    if (lobbiesContainer) lobbiesContainer.style.display = 'none';
    if (createLobbySection) createLobbySection.style.display = 'none';

    currentRoomEl.style.display = 'block';
    currentGameId = meta.gameId || currentGameId;
    currentRoomTitle.textContent = meta.lobbyName || `Room ${currentGameId ? currentGameId.slice(0,6) : ''}`;

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

    // If I'm the owner, show start button
    if (currentPlayerId && currentOwnerId && currentPlayerId === currentOwnerId) {
      const startBtn = document.createElement('button');
      startBtn.textContent = 'Start Game';
      startBtn.onclick = () => {
        const handSize = 7;
        socket.emit('startGame', { gameId: currentGameId, handSize });
      };
      roomControls.appendChild(startBtn);
    }

    // Smooth scroll the room into view for a nicer UX
    try {
      currentRoomEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { /* ignore if not supported */ }
  }

  // escape helper
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, t => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[t]));
  }

  // receive lobby list
  socket.on('lobbyList', (list) => {
    renderLobbyList(list);
  });

  // success on create
  socket.on('lobbyCreated', ({ gameId, lobbyName }) => {
    currentGameId = gameId;
    // show focused room UI for the creator and make them the owner
    showCurrentRoom({
      gameId,
      lobbyName,
      ownerId: socket.id,
      ownerName: window.CURRENT_USER || 'Host',
      playerCount: 1,
      maxPlayers: parseInt(createMax.value, 10) || 8
    });
    // request updated lobbies and player list
    socket.emit('getLobbies');
  });

  // joined a lobby (server responds after join)
  socket.on('joined', ({ playerId, gameId }) => {
    currentPlayerId = playerId || currentPlayerId;
    currentGameId = gameId || currentGameId;
    // request current lobby list to update UI
    socket.emit('getLobbies');
    // show current room area 
    showCurrentRoom({ gameId, lobbyName: `Room ${gameId.slice(0,6)}` });
  });

  // player list update for the room
  socket.on('playerList', (players) => {
    renderPlayers(players);
  });

  socket.on('ownerChanged', ({ ownerId, ownerName }) => {
    currentOwnerId = ownerId;
    // show the room
    showCurrentRoom({ ownerId, ownerName });
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

  // when a game started for this room we navigate to /game
  socket.on('gameStarted', ({ currentPlayerId: cp, players }) => {
    window.location.href = '/game?gameId=' + encodeURIComponent(currentGameId);
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