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

  // When socket connects, send join request for this room
  socket.on('connect', () => {
    socket.emit('joinLobby', { gameId, playerName: currentUser });
  });

  socket.on('joined', ({ playerId, gameId: gid }) => {
  });

  socket.on('playerList', (players) => {
    roomPlayerList.innerHTML = '<h3>Players</h3>';
    players.forEach(p => {
      const pDiv = document.createElement('div');
      const ownerLabel = (p.id === currentOwnerId) ? ' (Owner)' : '';
      const readyLabel = p.ready ? ' ✅ Ready' : ' ⏳ Not Ready';
      pDiv.textContent = p.name + ownerLabel + readyLabel;

      if (p.id === socket.id || p.id === socket.id) {
      const readyBtn = document.createElement('button');
      readyBtn.textContent = p.ready ? 'Unready' : 'Ready';
      readyBtn.onclick = () => {
        socket.emit('setReady', { gameId, ready: !p.ready });
      };
      pDiv.appendChild(readyBtn);
    }

    roomPlayerList.appendChild(pDiv);
    });
    roomInfo.textContent = `Players: ${players.length}`;
  });

  socket.on('ownerChanged', ({ ownerId, ownerName }) => {
    currentOwnerId = ownerId;
    roomInfo.textContent = `Owner: ${ownerName}`;
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

  // show start button if you're owner
  socket.on('lobbyCreated', ({ gameId: createdId }) => {
    if (createdId === gameId) {
    }
  });
});