document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  const gameId = window.GAME_ID;
  const currentUser = window.CURRENT_USER || 'Guest';

  const roomTitle = document.getElementById('roomTitle');
  const roomInfo = document.getElementById('roomInfo');
  const roomPlayerList = document.getElementById('roomPlayerList');
  const roomControls = document.getElementById('roomControls');
  const leaveRoomBtn = document.getElementById('leaveRoomBtn');

  roomTitle.textContent =  window.LOBBY_NAME ||`Room ${gameId ? gameId.slice(0,6) : ''}`;
  let currentOwnerId = null;
  let currentOwnerName = null;
  let currentPlayerId = null;
  let lastPlayers = [];

  // When socket connects, send join request for this room
  socket.on('connect', () => {
    socket.emit('joinLobby', { gameId, playerName: currentUser });
  });

  socket.on('joined', ({ playerId, gameId: gid }) => {
    currentPlayerId = playerId || socket.id;
  });

  socket.on('playerList', (players) => {
    lastPlayers = players || [];
    // render list
    roomPlayerList.innerHTML = '<h3>Players</h3>';
    players.forEach(p => {
      const pDiv = document.createElement('div');
      const ownerLabel = (p.id === currentOwnerId) ? ' (Owner)' : '';
      const readyLabel = p.ready ? ' ✅ Ready' : ' ⏳ Not Ready';
      pDiv.textContent = p.name + ownerLabel + readyLabel;

      // show ready toggle only for the current user
      if (currentPlayerId && p.id === currentPlayerId) {
        const readyBtn = document.createElement('button');
        readyBtn.textContent = p.ready ? 'Unready' : 'Ready';
        readyBtn.onclick = () => {
          socket.emit('setReady', { gameId, ready: !p.ready });
        };
        pDiv.appendChild(readyBtn);
      }

      roomPlayerList.appendChild(pDiv);
    });

    // update room info
    const ownerText = currentOwnerName ? `Owner: ${currentOwnerName}` : (currentOwnerId ? 'Owner: (unknown)' : 'Owner: -');
    roomInfo.textContent = `${ownerText} | Players: ${players.length}`;

    renderRoomControls();
  });

  socket.on('ownerChanged', ({ ownerId, ownerName }) => {
    currentOwnerId = ownerId;
    currentOwnerName = ownerName;
    // update room info and controls
    roomInfo.textContent = `Owner: ${ownerName}`;
    renderRoomControls();
  });

  socket.on('gameStarted', ({ currentPlayerId, players }) => {
    // navigate to game page
    window.location.href = '/game?gameId=' + encodeURIComponent(gameId);
  });

  socket.on('startFailed', ({ reason }) => {
    alert('Game start failed: ' + reason || 'ALL players must be ready');
  });

  leaveRoomBtn.addEventListener('click', () => {
    socket.emit('leaveLobby', { gameId });
    window.location.href = '/lobby';
  });

  function renderRoomControls() {
    roomControls.innerHTML = '';
    if (!currentPlayerId) return;
    // if I'm the owner, show Start Game button (enabled only when all ready)
    if (currentPlayerId === currentOwnerId) {
      const players = Array.isArray(lastPlayers) ? lastPlayers : [];
      const allReady = players.length > 0 && players.every(p => !!p.ready);
      const startBtn = document.createElement('button');
      startBtn.textContent = 'Start Game';
      startBtn.disabled = !allReady;
      startBtn.onclick = () => {
        socket.emit('startGame', { gameId, handSize: 7 });
      };
      roomControls.appendChild(startBtn);

      if (!allReady) {
        const note = document.createElement('div');
        note.textContent = 'All players must be ready to start.';
        roomControls.appendChild(note);
      }
    }
  }

  // show start button if you're owner
  socket.on('lobbyCreated', ({ gameId: createdId }) => {
    if (createdId === gameId) {
    }
  });
});