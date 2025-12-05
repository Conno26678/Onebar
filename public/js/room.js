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
  let currentRoomIsPrivate = false;
  let currentJoinCode = null;

  // When socket connects, send join request for this room
  socket.on('connect', () => {
    currentPlayerId = socket.id;
    socket.emit('joinLobby', { gameId, playerName: currentUser });
  });

  socket.on('joined', ({ playerId, gameId: gid, lobbyName, isPrivate = false, joinCode = null }) => {
    currentPlayerId = playerId || socket.id;
    // remember privacy state and join code (owner will receive joinCode)
    currentRoomIsPrivate = !!isPrivate;
    if (joinCode && currentPlayerId === currentOwnerId) currentJoinCode = joinCode;
    renderRoomControls();
  });

  // If join failed because lobby is private, prompt for join code and retry
  socket.on('lobbyJoinError', ({ reason }) => {
    if (reason && reason.toString().toLowerCase().includes('private') || (reason && reason.toString().toLowerCase().includes('code'))) {
      const code = prompt('This lobby is private. Enter join code:');
      if (code) {
        socket.emit('joinLobby', { gameId, playerName: currentUser, joinCode: code });
        return;
      }
    }
    alert('Unable to join: ' + (reason || 'Unknown reason'));
    window.location.href = '/lobby';
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
    const playerCount = lastPlayers.length || 0;
    roomInfo.textContent = `Owner: ${ownerName} | Players: ${playerCount}`;
    renderRoomControls();
  });

  socket.on('privateChanged', ({ isPrivate }) => {
    currentRoomIsPrivate = !!isPrivate;
    renderRoomControls();
  });

  socket.on('privateSet', ({ joinCode }) => {
    currentJoinCode = joinCode || null;
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
    // privacy toggle for owner
    if (currentPlayerId === currentOwnerId) {
      const privDiv = document.createElement('div');
      const privLabel = document.createElement('label');
      privLabel.textContent = 'Private: ';
      const privCheckbox = document.createElement('input');
      privCheckbox.type = 'checkbox';
      privCheckbox.checked = !!currentRoomIsPrivate;
      privCheckbox.onchange = () => {
        const makePrivate = !!privCheckbox.checked;
        socket.emit('setPrivate', { gameId, isPrivate: makePrivate });
      };
      privLabel.appendChild(privCheckbox);
      privDiv.appendChild(privLabel);

      if (currentRoomIsPrivate && currentJoinCode) {
        const codeDiv = document.createElement('div');
        codeDiv.textContent = 'Join code: ' + currentJoinCode;
        privDiv.appendChild(codeDiv);
      }
      roomControls.appendChild(privDiv);
    }
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