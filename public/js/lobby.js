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

  let currentGameId = null;
  let currentPlayerId = null;
  let currentOwnerId = null;

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
  }

  function showCurrentRoom(meta) {
    currentRoomEl.style.display = 'block';
    currentRoomTitle.textContent = meta.lobbyName || 'Room';
    currentRoomInfo.innerHTML = `Owner: ${meta.ownerName} | Players: ${meta.playerCount}/${meta.maxPlayers}`;
    currentOwnerId = meta.ownerId;
    roomControls.innerHTML = '';

    // If I'm the owner, show start button
    if (currentPlayerId && currentPlayerId === currentOwnerId) {
      const startBtn = document.createElement('button');
      startBtn.textContent = 'Start Game';
      startBtn.onclick = () => {
        const handSize = 7;
        socket.emit('startGame', { gameId: currentGameId, handSize });
      };
      roomControls.appendChild(startBtn);
    }
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
    // we automatically join (server added us)
    currentRoomTitle.textContent = lobbyName;
    currentRoomInfo.textContent = 'Waiting for players...';
  });

  // joined a lobby (server responds after join)
  socket.on('joined', ({ playerId, gameId }) => {
    currentPlayerId = playerId;
    currentGameId = gameId;
    // request current lobby list to update UI
    socket.emit('getLobbies');
    // request player list will come separately
    // show current room area
    currentRoomEl.style.display = 'block';
    currentRoomTitle.textContent = 'Room ' + gameId.slice(0,6);
  });

  // player list update for the room
  socket.on('playerList', (players) => {
    renderPlayers(players);
  });

  socket.on('ownerChanged', ({ ownerId, ownerName }) => {
    currentOwnerId = ownerId;
    // update UI: re-request lobbies to refresh owner display
    socket.emit('getLobbies');
  });

  // join failed feedback
  socket.on('joinFailed', ({ reason }) => {
    alert('Unable to join: ' + reason);
  });

  // when a game started for this room we navigate to /game (or display)
  socket.on('gameStarted', ({ currentPlayerId: cp, players }) => {
    // navigate to /game and you can include gameId info via localStorage or query string
    // for simplicity, just go to /game and client should rejoin the game with gameId
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
    currentPlayerId = null;
    currentOwnerId = null;
    currentRoomEl.style.display = 'none';
  });

  // helpful utility: request lobby list periodically
  setInterval(() => {
    socket.emit('getLobbies');
  }, 5000);
});