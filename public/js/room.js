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

  roomTitle.textContent = (window.LOBBY_NAME || `Room ${gameId ? gameId.slice(0,6) : ''}`);
  let currentOwnerId = null;
  let currentOwnerName = null;
  let currentPlayerId = null;
  let lastPlayers = [];
  let currentRoomIsPrivate = false;
  let currentJoinCode = null;
  let hasPromptedForCode = false;
  let hasPaid = false; // Track payment status

  // Check for join code in URL (from join-by-code flow)
  const urlParams = new URLSearchParams(window.location.search);
  const urlJoinCode = urlParams.get('code');

  // Listen for payment status updates
  socket.on('paymentStatus', ({ hasPaid: paid }) => {
    hasPaid = paid;
    console.log('Payment status updated:', hasPaid);
  });

  // When socket connects, send join request for this room
  socket.on('connect', () => {
    currentPlayerId = socket.id;
    socket.emit('joinLobby', { gameId, playerName: currentUser, joinCode: urlJoinCode || null });
  });

   socket.on('joined', ({ playerId, isPrivate = false, joinCode = null, ownerId = null, ownerName = null }) => {
    currentPlayerId = playerId || socket.id;
    // remember privacy state and join code
    currentRoomIsPrivate = !!isPrivate;
    if (joinCode) currentJoinCode = joinCode;
    
    // Set owner info from server immediately
    currentOwnerId = ownerId;
    currentOwnerName = ownerName;

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
    roomPlayerList.innerHTML = '';
    if (players.length === 0) {
      roomPlayerList.innerHTML = '<div class="waiting-indicator">Waiting for players<span class="dots">...</span></div>';
    } else {
      players.forEach(p => {
        const pDiv = document.createElement('div');
        pDiv.className = 'player-tag fade-in' + (p.id === currentOwnerId ? ' host' : '');
        
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

        // show ready toggle only for the current user
        if (currentPlayerId && p.id === currentPlayerId) {
          const readyBtn = document.createElement('button');
          readyBtn.className = 'ready-btn';
          readyBtn.textContent = p.ready ? 'Unready' : 'Ready';
          readyBtn.onclick = (e) => {
            e.stopPropagation();
            const newReadyState = !p.ready;
            socket.emit('setReady', { gameId, ready: newReadyState});
          };
          pDiv.appendChild(readyBtn);
        }

        roomPlayerList.appendChild(pDiv);
      });
    }

    // update room info
    const ownerText = currentOwnerName ? `Host ${currentOwnerName}` : (currentOwnerId ? 'Host' : '');
    roomInfo.innerHTML = `<div class="info-item">${ownerText}</div><div class="info-item">👥 ${players.length} Players</div>`;

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

  socket.on('gameStarted', () => {
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
        showCopyNotification('Join code copied!');
      }).catch(() => {
        fallbackCopy(code);
      });
    } else {
      fallbackCopy(code);
    }
  }

  function showCopyNotification(message) {
    // Create a toast notification
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--gradient-accent, linear-gradient(135deg, #38a169, #68d391));
      color: white;
      padding: 12px 24px;
      border-radius: 12px;
      font-weight: 600;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      z-index: 10000;
      animation: slideUp 0.3s ease-out;
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
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
      showCopyNotification('Join code copied!');
    } catch (err) {
      alert('Unable to copy join code to clipboard');
    }
    document.body.removeChild(textArea);
  }

  function updateJoinCodeDisplay() {
    // Display join code in the persistent container (not cleared by other updates)
    console.log('updateJoinCodeDisplay called:', { currentRoomIsPrivate, currentJoinCode, currentPlayerId, currentOwnerId });
    
    // Only show to owner when room is private and we have a code
    if (currentRoomIsPrivate && currentJoinCode && currentPlayerId === currentOwnerId) {
      console.log('Showing join code!');
      joinCodeContainer.style.display = 'block';
      roomJoinCodeDisplay.textContent = currentJoinCode;
      roomJoinCodeDisplay.onclick = () => copyJoinCode();
    } else {
      joinCodeContainer.style.display = 'none';
    }
  }

  function renderRoomControls() {
    // Only update controls if there's an actual change needed
    // Check if we already have the right controls rendered
    const existingStartBtn = roomControls.querySelector('.start-btn');
    const existingPrivToggle = roomControls.querySelector('.privacy-toggle');
    
    if (!currentPlayerId) {
      roomControls.innerHTML = '';
      return;
    }
    
    // if I'm the owner, show Start Game button (enabled only when all ready) and private toggle
    if (currentPlayerId === currentOwnerId) {
      // Only rebuild controls if they don't exist yet
      if (!existingStartBtn || !existingPrivToggle) {
        roomControls.innerHTML = '';
        
        // Private lobby toggle
        const privDiv = document.createElement('div');
        privDiv.className = 'privacy-toggle';
        const privLabel = document.createElement('label');
        privLabel.className = 'checkbox-wrapper';
        const privCheckbox = document.createElement('input');
        privCheckbox.type = 'checkbox';
        privCheckbox.id = 'privacyCheckbox';
        privCheckbox.checked = !!currentRoomIsPrivate;
        privCheckbox.onchange = () => {
          const makePrivate = !!privCheckbox.checked;
          socket.emit('setPrivate', { gameId, isPrivate: makePrivate });
        };
        const labelText = document.createElement('span');
        labelText.textContent = 'Private Lobby';
        privLabel.appendChild(privCheckbox);
        privLabel.appendChild(labelText);
        privDiv.appendChild(privLabel);
        roomControls.appendChild(privDiv);

        const startBtn = document.createElement('button');
        startBtn.className = 'start-btn';
        startBtn.textContent = 'Start Game';
        startBtn.onclick = () => {
          socket.emit('startGame', { gameId, handSize: 7 });
        };
        roomControls.appendChild(startBtn);

        const note = document.createElement('div');
        note.className = 'waiting-note';
        roomControls.appendChild(note);
      }
      
      // Update the state of existing controls without clearing
      const players = Array.isArray(lastPlayers) ? lastPlayers : [];
      const allReady = players.length > 0 && players.every(p => !!p.ready);
      
      const startBtn = roomControls.querySelector('.start-btn');
      if (startBtn) {
        startBtn.disabled = !allReady;
      }
      
      const privCheckbox = roomControls.querySelector('#privacyCheckbox');
      if (privCheckbox) {
        privCheckbox.checked = !!currentRoomIsPrivate;
      }
      
      const note = roomControls.querySelector('.waiting-note');
      if (note) {
        note.textContent = allReady ? '' : 'Waiting for all players to be ready...';
        note.style.display = allReady ? 'none' : 'block';
      }
    } else {
      // Not the owner, clear controls
      roomControls.innerHTML = '';
    }
  }

  // show start button if you're owner
  socket.on('lobbyCreated', ({ gameId: createdId }) => {
    if (createdId === gameId) {
    }
  });

  // Winner screen handler
  socket.on('showWinnerScreen', ({ winnerName, winnerId, digipogs, playerCount, payoutError = false }) => {
    console.log('🏆 Winner screen data:', { winnerName, winnerId, digipogs, playerCount, payoutError });
    
    const modal = document.getElementById('winnerModal');
    const nameDisplay = document.getElementById('winnerNameDisplay');
    const earningsDisplay = document.getElementById('winnerEarningsDisplay');
    const xpDisplay = document.getElementById('winnerXpDisplay');
    
    console.log('XP Display element:', xpDisplay);
    
    const isCurrentUserWinner = winnerName === currentUser;
    
    // Calculate XP based on performance
    let xpEarned = 0;
    if (isCurrentUserWinner) {
      // Winner gets more XP based on player count
      xpEarned = 100 + (playerCount * 25); // Base 100 + 25 per player
      nameDisplay.textContent = 'You are the winner!';
      
      if (payoutError) {
        // Only show error to the winner
        earningsDisplay.innerHTML = `<strong>Winner!</strong><br><small>Payout processing failed</small>`;
      } else {
        earningsDisplay.innerHTML = `You won <strong>${digipogs}</strong> Digipogs!<br><small>${playerCount} players</small>`;
      }
    } else {
      // Loser gets participation XP based on player count
      xpEarned = 25 + (playerCount * 5); // Base 25 + 5 per player
      nameDisplay.textContent = `get gud`;
      earningsDisplay.innerHTML = `${winnerName} won <strong>${digipogs}</strong> Digipogs!<br><small>Try to win next time to earn some!</small>`;
    }
    
    console.log('⭐ XP Earned:', xpEarned);
    console.log('Current User:', currentUser);
    
    // Save XP to localStorage (you can later sync this to backend)
    const currentXp = parseInt(localStorage.getItem('userXp') || '0');
    const newXp = currentXp + xpEarned;
    localStorage.setItem('userXp', newXp.toString());
    
    // Calculate level based on XP (every 1000 XP = 1 level)
    const currentLevel = Math.floor(newXp / 1000) + 1;
    console.log(`💾 Saved XP: ${currentXp} → ${newXp}, Level: ${currentLevel}`);
    
    // Show XP notification box in upper right corner
    const xpNotification = document.getElementById('xpNotification');
    const xpNotifPlayerName = document.getElementById('xpNotifPlayerName');
    const xpNotifLevel = document.getElementById('xpNotifLevel');
    const xpNotifEarned = document.getElementById('xpNotifEarned');
    
    console.log('XP Notification elements:', {
      xpNotification,
      xpNotifPlayerName,
      xpNotifLevel,
      xpNotifEarned
    });
    
    if (xpNotification && xpNotifPlayerName && xpNotifLevel && xpNotifEarned) {
      console.log('📝 Setting XP notification content...');
      xpNotifPlayerName.textContent = currentUser;
      xpNotifLevel.textContent = currentLevel;
      xpNotifEarned.textContent = `+${xpEarned} XP`;
      
      console.log('🎨 Displaying XP notification...');
      xpNotification.style.display = 'block';
      xpNotification.style.opacity = '1';
      xpNotification.style.visibility = 'visible';
      
      // Animate in
      setTimeout(() => {
        xpNotification.style.animation = 'slideInRight 0.5s ease-out';
        console.log('✅ XP Notification displayed and animated');
      }, 100);
    } else {
      console.error('❌ XP Notification element not found!');
      console.error('Missing elements:', {
        notification: !xpNotification,
        playerName: !xpNotifPlayerName,
        level: !xpNotifLevel,
        earned: !xpNotifEarned
      });
    }
    
    modal.style.display = 'flex';
  });

  // Play Again button handler
  document.getElementById('playAgainBtn').addEventListener('click', () => {
    console.log('Play Again button clicked, emitting playAgain event');
    socket.emit('playAgain', { gameId });
    // Close the winner modal and XP notification
    document.getElementById('winnerModal').style.display = 'none';
    const xpNotification = document.getElementById('xpNotification');
    if (xpNotification) xpNotification.style.display = 'none';
  });

  // Handle play again payment requirement
  socket.on('playAgainPaymentRequired', () => {
    console.log('Payment required! Showing payment modal...');
    // Close winner modal and XP notification
    document.getElementById('winnerModal').style.display = 'none';
    const xpNotification = document.getElementById('xpNotification');
    if (xpNotification) xpNotification.style.display = 'none';
    // Show payment modal
    const modal = document.getElementById('paymentModal');
    console.log('Payment modal element:', modal);
    if (modal) {
      modal.style.display = 'block';
      console.log('Payment modal should now be visible');
    } else {
      console.error('Payment modal element not found!');
    }
  });

  // Handle game reset (from play again)
  socket.on('gameReset', ({ message }) => {
    console.log('Game reset:', message);
    // Close winner modal and XP notification if still open
    document.getElementById('winnerModal').style.display = 'none';
    const xpNotification = document.getElementById('xpNotification');
    if (xpNotification) xpNotification.style.display = 'none';
    // The playerList update will refresh the UI automatically
  });

  // Back to Lobby button handler
  document.getElementById('backToLobbyBtn').addEventListener('click', () => {
    // Hide XP notification before leaving
    const xpNotification = document.getElementById('xpNotification');
    if (xpNotification) xpNotification.style.display = 'none';
    window.location.href = '/lobby';
  });

  // Payment modal functions
  window.showPaymentModal = function () {
    const modal = document.getElementById('paymentModal');
    if (modal) modal.style.display = 'block';
  };

  window.hidePaymentModal = function () {
    const modal = document.getElementById('paymentModal');
    if (modal) modal.style.display = 'none';
  };

  // Listen for payment success
  window.addEventListener('paymentSuccess', () => {
    console.log('Payment successful! Refreshing payment status...');
    hidePaymentModal();
    // Request server to refresh payment status
    socket.emit('refreshPaymentStatus');
    // Wait a brief moment for server to update session, then retry play again
    setTimeout(() => {
      console.log('Retrying play again after payment...');
      socket.emit('playAgain', { gameId });
    }, 500);
  });

  window.addEventListener('hidePaymentModal', () => {
    hidePaymentModal();
  });
});