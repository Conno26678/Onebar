document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  const gameId = window.GAME_ID;
  const currentUser = window.CURRENT_USER || 'Guest';

  const roomTitle = document.getElementById('roomTitle');
  const roomJoinCodeDisplay = document.getElementById('roomJoinCodeDisplay');
  const joinCodeContainer = document.getElementById('joinCodeContainer');
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
  let hasPromptedForCode = false;

  // Check for join code in URL (from join-by-code flow)
  const urlParams = new URLSearchParams(window.location.search);
  const urlJoinCode = urlParams.get('code');

  // When socket connects, send join request for this room
  socket.on('connect', () => {
    currentPlayerId = socket.id;
    socket.emit('joinLobby', { gameId, playerName: currentUser, joinCode: urlJoinCode || null });
  });

   socket.on('joined', ({ playerId, gameId: gid, lobbyName, isPrivate = false, joinCode = null, ownerId = null, ownerName = null }) => {
    currentPlayerId = playerId || socket.id;
    // remember privacy state and join code
    currentRoomIsPrivate = !!isPrivate;
    if (joinCode) currentJoinCode = joinCode;
    updateJoinCodeDisplay();
    renderRoomControls();

    if (ownerId) {
      currentOwnerId = ownerId;
      if (ownerName) currentOwnerName = ownerName;
    } else if (!currentOwnerId && currentPlayerId && currentPlayerId === socket.id) {
        currentOwnerId = currentPlayerId;
      }

      updateJoinCodeDisplay();
      renderRoomControls();
  });

  // If join failed because lobby is private, show join code input and retry
  socket.on('lobbyJoinError', ({ reason }) => {
    console.log('hasPromptedForCode:', hasPromptedForCode);
    if ((reason && (reason.toString().toLowerCase().includes('private') || reason.toString().toLowerCase().includes('code'))) && !hasPromptedForCode) {
      hasPromptedForCode = true;
      showJoinCodeInput();
      return;
    }
    alert('Unable to join: ' + (reason || 'Unknown error'));
    window.location.href = '/lobby';
  });

  function showJoinCodeInput() {
    // Create join code input UI
    roomControls.innerHTML = '';
    const inputContainer = document.createElement('div');
    inputContainer.style.marginTop = '20px';
    const label = document.createElement('label');
    label.textContent = 'This lobby is private. Enter join code: ';
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.id = 'joinCodeInput';
    codeInput.placeholder = 'Enter code';
    codeInput.style.marginRight = '10px';
    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Join';
    submitBtn.onclick = () => {
      const code = codeInput.value.trim().toUpperCase();
      if (code) {
        socket.emit('joinLobby', { gameId, playerName: currentUser, joinCode: code });
      }
    };
    inputContainer.appendChild(label);
    inputContainer.appendChild(codeInput);
    inputContainer.appendChild(submitBtn);
    roomControls.appendChild(inputContainer);
  }

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
          const newReadyState = !p.ready;
          socket.emit('setReady', { gameId, ready: newReadyState});
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
    console.log('ownerChanged received:', { ownerId, ownerName, currentPlayerId });
    currentOwnerId = ownerId;
    currentOwnerName = ownerName;
    // update room info and controls
    const playerCount = lastPlayers.length || 0;
    roomInfo.textContent = `Owner: ${ownerName} | Players: ${playerCount}`;
    updateJoinCodeDisplay();
    renderRoomControls();
  });

  socket.on('privateChanged', ({ isPrivate }) => {
    console.log('privateChanged received:', { isPrivate });
    currentRoomIsPrivate = !!isPrivate;
    updateJoinCodeDisplay();
    renderRoomControls();
  });

  socket.on('privateSet', ({ joinCode }) => {
    console.log('privateSet received:', { joinCode, currentPlayerId, currentOwnerId });
    currentJoinCode = joinCode || null;
    updateJoinCodeDisplay();
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

  function copyJoinCode() {
    const code = currentJoinCode || '';
    if (!code) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        alert('Join code copied to clipboard: ' + code);
      }).catch(err => {
        fallbackCopy(code);
      });
    } else {
      fallbackCopy(code);
    }
  }

  function fallbackCopy(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      alert('Join code copied to clipboard: ' + text);
    } catch (err) {
      alert(' Copy failed. Unable to copy join code to clipboard');
    }
    document.body.removeChild(textArea);
  }

  function updateJoinCodeDisplay() {
    // Display join code in the persistent container (not cleared by other updates)
    console.log('updateJoinCodeDisplay called:', { currentRoomIsPrivate, currentJoinCode, currentPlayerId, currentOwnerId });
    joinCodeContainer.innerHTML = '';
    
    // Only show to owner when room is private and we have a code
    if (currentRoomIsPrivate && currentJoinCode && currentPlayerId === currentOwnerId) {
      console.log('Showing join code!');
      const wrapper = document.createElement('div');
      wrapper.style.padding = '10px';
      wrapper.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
      wrapper.style.borderRadius = '8px';
      wrapper.style.display = 'inline-flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '10px';

      const label = document.createElement('span');
      label.textContent = 'Join Code: ';
      label.style.fontWeight = 'bold';

      const codeSpan = document.createElement('span');
      codeSpan.textContent = currentJoinCode;
      codeSpan.style.fontSize = '1.2em';
      codeSpan.style.fontWeight = 'bold';
      codeSpan.style.letterSpacing = '2px';
      codeSpan.style.padding = '4px 8px';
      codeSpan.style.backgroundColor = '#fff';
      codeSpan.style.color = '#333';
      codeSpan.style.border = '1px solid #ccc';
      codeSpan.style.borderRadius = '4px';

      const copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy Code';
      copyBtn.type = 'button';
      copyBtn.style.padding = '6px 12px';
      copyBtn.style.cursor = 'pointer';
      copyBtn.addEventListener('click', function() {
        copyJoinCode();
      });

      wrapper.appendChild(label);
      wrapper.appendChild(codeSpan);
      wrapper.appendChild(copyBtn);
      joinCodeContainer.appendChild(wrapper);
    }
  }

  function renderRoomControls() {
    roomControls.innerHTML = '';
    if (!currentPlayerId) return;
    // if I'm the owner, show Start Game button (enabled only when all ready) and private toggle
    if (currentPlayerId === currentOwnerId) {
      // Private lobby toggle
      const privDiv = document.createElement('div');
      privDiv.style.marginBottom = '10px';
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
      roomControls.appendChild(privDiv);

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