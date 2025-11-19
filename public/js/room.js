document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  const gameId = window.GAME_ID;
  const currentUser = window.CURRENT_USER || 'Guest';

  const roomTitle = document.getElementById('roomTitle');
  const roomInfo = document.getElementById('roomInfo');
  const roomPlayerList = document.getElementById('roomPlayerList');
  const roomControls = document.getElementById('roomControls');
  const leaveRoomBtn = document.getElementById('leaveRoomBtn');

  roomTitle.textContent = `Room ${gameId ? gameId.slice(0,6) : ''}`;

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
      pDiv.textContent = p.name;
      roomPlayerList.appendChild(pDiv);
    });
    roomInfo.textContent = `Players: ${players.length}`;
  });

  socket.on('ownerChanged', ({ ownerId, ownerName }) => {
    roomInfo.textContent = `Owner: ${ownerName}`;
  });

  socket.on('gameStarted', ({ currentPlayerId, players }) => {
    // navigate to game page
    window.location.href = '/game?gameId=' + encodeURIComponent(gameId);
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