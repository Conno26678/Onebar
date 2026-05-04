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
  let currentGameRules = {
    stacking: false,
    jumpIn: false,
    sevenZero: false
  };
  let readyTimeouts = new Map();
  let countdownIntervals = new Map();
  let hasPromptedForCode = false;
  let hasPaid = false; // Track payment status
  let rulesVisible = false; // Track custom rules panel visibility

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

   socket.on('joined', ({ playerId, isPrivate = false, joinCode = null, ownerId = null, ownerName = null, rules = null }) => {
    currentPlayerId = playerId || socket.id;
    console.log('joined event - setting currentPlayerId:', currentPlayerId);
    // remember privacy state and join code
    currentRoomIsPrivate = !!isPrivate;
    if (joinCode) currentJoinCode = joinCode;
    
    // Set game rules if provided
    if (rules) {
      currentGameRules = { ...currentGameRules, ...rules };
    }
    
    // Set owner info from server immediately
    currentOwnerId = ownerId;
    currentOwnerName = ownerName;
    console.log('joined event - setting currentOwnerId:', currentOwnerId, 'currentOwnerName:', currentOwnerName);

    updateJoinCodeDisplay();
    renderReadyButton();
    renderRulesPanel();
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
        // Ensure currentOwnerId is set before checking (it should be set from joined/lobbyCreated events)
        const isHost = currentOwnerId && p.id === currentOwnerId;
        pDiv.className = 'player-tag fade-in' + (isHost ? ' host' : '');
        pDiv.setAttribute('data-player-id', p.id);
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name;
        pDiv.appendChild(nameSpan);
        
        if (isHost) {
          const hostBadge = document.createElement('span');
          hostBadge.className = 'host-badge';
          hostBadge.textContent = ' Host';
          pDiv.appendChild(hostBadge);
        }
        
        const readySpan = document.createElement('span');
        readySpan.className = 'ready-status ' + (p.ready ? 'ready' : 'not-ready');
        pDiv.appendChild(readySpan);
        
        // Show countdown for non-ready, non-host players
        if (!p.ready && !isHost) {
          const countdownSpan = document.createElement('span');
          countdownSpan.className = 'ready-countdown';
          countdownSpan.id = `countdown-${p.id}`;
          countdownSpan.textContent = '';
          pDiv.appendChild(countdownSpan);
        }

        roomPlayerList.appendChild(pDiv);
      });
    }

    // update room info
    const ownerText = currentOwnerName ? `Host ${currentOwnerName}` : (currentOwnerId ? 'Host' : '');
    roomInfo.innerHTML = `<div class="info-item">${ownerText}</div><div class="info-item">👥 ${players.length} Players</div>`;

    renderReadyButton();
    renderRulesPanel();
  });

  socket.on('ownerChanged', ({ ownerId, ownerName }) => {
    console.log('ownerChanged received:', { ownerId, ownerName, currentPlayerId });
    currentOwnerId = ownerId;
    currentOwnerName = ownerName;
    
    console.log('Triggering renderRulesPanel from ownerChanged');
    
    // Re-render player list to show new host badge
    if (lastPlayers.length > 0) {
      const players = lastPlayers;
      roomPlayerList.innerHTML = '';
      players.forEach(p => {
        const pDiv = document.createElement('div');
        const isHost = currentOwnerId && p.id === currentOwnerId;
        pDiv.className = 'player-tag fade-in' + (isHost ? ' host' : '');
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name;
        pDiv.appendChild(nameSpan);
        
        if (isHost) {
          const hostBadge = document.createElement('span');
          hostBadge.className = 'host-badge';
          hostBadge.textContent = ' Host';
          pDiv.appendChild(hostBadge);
        }
        
        const readySpan = document.createElement('span');
        readySpan.className = 'ready-status ' + (p.ready ? 'ready' : 'not-ready');
        pDiv.appendChild(readySpan);
        
        // Show countdown for non-ready, non-host players
        if (!p.ready && !isHost) {
          const countdownSpan = document.createElement('span');
          countdownSpan.className = 'ready-countdown';
          countdownSpan.id = `countdown-${p.id}`;
          countdownSpan.textContent = '';
          pDiv.appendChild(countdownSpan);
        }

        roomPlayerList.appendChild(pDiv);
      });
    }
    
    // update room info
    const playerCount = lastPlayers.length || 0;
    roomInfo.textContent = `Owner: ${ownerName} | Players: ${playerCount}`;
    updateJoinCodeDisplay();
    renderReadyButton();
    renderRulesPanel();
  });

  socket.on('privateChanged', ({ isPrivate }) => {
    currentRoomIsPrivate = !!isPrivate;
    updateJoinCodeDisplay();
  });

  socket.on('privateSet', ({ joinCode }) => {
    currentJoinCode = joinCode || null;
    updateJoinCodeDisplay();
  });

  socket.on('gameStarted', () => {
    // navigate to game page
    window.location.href = '/game?gameId=' + encodeURIComponent(gameId);
  });

  socket.on('readyCountdown', ({ playerId, timeRemaining }) => {
    const countdownEl = document.getElementById(`countdown-${playerId}`);
    if (countdownEl) {
      if (timeRemaining > 0) {
        countdownEl.textContent = ` ⏱️${timeRemaining}s`;
        countdownEl.style.color = timeRemaining <= 10 ? '#e53e3e' : '#f0c030';
      } else {
        countdownEl.textContent = '';
      }
    }
  });

  socket.on('kickedForNotReady', ({ reason }) => {
    alert(reason || 'You were kicked for not readying up in time.');
    window.location.href = '/lobby';
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

  function renderReadyButton() {
    const readyButtonContainer = document.getElementById('readyButtonContainer');
    if (!readyButtonContainer) return;
    
    readyButtonContainer.innerHTML = '';
    
    if (!currentPlayerId) {
      console.log('renderReadyButton: currentPlayerId not set');
      return;
    }
    
    console.log('renderReadyButton:', { currentPlayerId, currentOwnerId, isOwner: currentPlayerId === currentOwnerId });
    
    // If owner, show start game button
    if (currentPlayerId === currentOwnerId) {
      const players = Array.isArray(lastPlayers) ? lastPlayers : [];
      // Allow start if all players are ready OR if host is the only player
      const allReady = players.length > 0 && players.every(p => !!p.ready);
      const isSinglePlayer = players.length === 1;
      const canStart = allReady || isSinglePlayer;
      
      const startBtn = document.createElement('button');
      startBtn.className = 'start-btn-large';
      startBtn.textContent = 'Start Game';
      startBtn.disabled = !canStart;
      startBtn.onclick = () => {
        socket.emit('startGame', { gameId, handSize: 7 });
      };
      
      readyButtonContainer.appendChild(startBtn);
      
      if (!canStart) {
        const note = document.createElement('div');
        note.className = 'waiting-note-below';
        note.textContent = 'Waiting for all players to be ready...';
        readyButtonContainer.appendChild(note);
      }
      
      // Add Custom Rules button for host
      const rulesBtn = document.createElement('button');
      rulesBtn.className = 'rules-toggle-btn';
      rulesBtn.innerHTML = '⚙️ Custom Rules';
      rulesBtn.onclick = () => {
        rulesVisible = !rulesVisible;
        renderRulesPanel();
      };
      readyButtonContainer.appendChild(rulesBtn);
    } else {
      // Not the owner, show ready button
      const currentPlayer = lastPlayers.find(p => p.id === currentPlayerId);
      if (!currentPlayer) return;
      
      const readyBtn = document.createElement('button');
      readyBtn.className = 'ready-btn-large';
      readyBtn.textContent = currentPlayer.ready ? 'Unready' : 'Ready Up';
      readyBtn.onclick = () => {
        const newReadyState = !currentPlayer.ready;
        socket.emit('setReady', { gameId, ready: newReadyState });
      };
      
      readyButtonContainer.appendChild(readyBtn);
    }
  }

  function renderRulesPanel() {
    if (!roomControls) {
      console.log('renderRulesPanel: roomControls not found');
      return;
    }
    
    console.log('renderRulesPanel called:', { currentPlayerId, currentOwnerId, isOwner: currentPlayerId === currentOwnerId, rulesVisible, currentGameRules });
    
    const isOwner = currentPlayerId && currentOwnerId && currentPlayerId === currentOwnerId;
    
    // For non-owners, show read-only rules display
    if (!isOwner) {
      roomControls.innerHTML = '';
      const rulesReadOnly = document.createElement('div');
      rulesReadOnly.className = 'rules-display-readonly';
      rulesReadOnly.innerHTML = `
        <h4>⚙️ Game Rules</h4>
        <div class="rule-item">
          <span class="rule-icon">${currentGameRules.stacking ? '✅' : '❌'}</span>
          <span><strong>Stacking:</strong> ${currentGameRules.stacking ? 'ON' : 'OFF'}</span>
        </div>
        <div class="rule-item">
          <span class="rule-icon">${currentGameRules.jumpIn ? '✅' : '❌'}</span>
          <span><strong>Jump-In:</strong> ${currentGameRules.jumpIn ? 'ON' : 'OFF'}</span>
        </div>
        <div class="rule-item">
          <span class="rule-icon">${currentGameRules.sevenZero ? '✅' : '❌'}</span>
          <span><strong>7-0 Rule:</strong> ${currentGameRules.sevenZero ? 'ON' : 'OFF'}</span>
        </div>
      `;
      roomControls.appendChild(rulesReadOnly);
      roomControls.style.display = 'block';
      console.log('Rendered read-only rules for non-owner');
      return;
    }
    
    // Only show rules panel for the host and when toggled visible
    if (!rulesVisible) {
      roomControls.innerHTML = '';
      roomControls.style.display = 'none';
      console.log('Not showing rules panel - not visible');
      return;
    }
    
    console.log('Showing rules panel for owner');
    roomControls.style.display = 'flex';
    roomControls.style.flexDirection = 'column';
    roomControls.style.alignItems = 'center';
    roomControls.innerHTML = '';
    
    const rulesContainer = document.createElement('div');
    rulesContainer.className = 'rules-panel';
    
    const rulesTitle = document.createElement('h4');
    rulesTitle.textContent = '⚙️ Game Rules';
    rulesTitle.style.marginBottom = '10px';
    rulesContainer.appendChild(rulesTitle);
    
    // Stacking rule
    const stackingDiv = document.createElement('div');
    stackingDiv.className = 'rule-option';
    const stackingLabel = document.createElement('label');
    stackingLabel.className = 'checkbox-wrapper';
    const stackingCheckbox = document.createElement('input');
    stackingCheckbox.type = 'checkbox';
    stackingCheckbox.id = 'stackingRule';
    stackingCheckbox.checked = currentGameRules.stacking;
    stackingCheckbox.onchange = () => {
      currentGameRules.stacking = stackingCheckbox.checked;
      socket.emit('setGameRules', { gameId, rules: { stacking: stackingCheckbox.checked, jumpIn: currentGameRules.jumpIn, sevenZero: currentGameRules.sevenZero } });
    };
    const stackingText = document.createElement('span');
    stackingText.innerHTML = '<strong>Stacking:</strong> Players can stack +2 and +4 cards';
    stackingLabel.appendChild(stackingCheckbox);
    stackingLabel.appendChild(stackingText);
    stackingDiv.appendChild(stackingLabel);
    rulesContainer.appendChild(stackingDiv);
    
    // Jump-in rule
    const jumpInDiv = document.createElement('div');
    jumpInDiv.className = 'rule-option';
    const jumpInLabel = document.createElement('label');
    jumpInLabel.className = 'checkbox-wrapper';
    const jumpInCheckbox = document.createElement('input');
    jumpInCheckbox.type = 'checkbox';
    jumpInCheckbox.id = 'jumpInRule';
    jumpInCheckbox.checked = currentGameRules.jumpIn;
    jumpInCheckbox.onchange = () => {
      currentGameRules.jumpIn = jumpInCheckbox.checked;
      socket.emit('setGameRules', { gameId, rules: { stacking: currentGameRules.stacking, jumpIn: jumpInCheckbox.checked, sevenZero: currentGameRules.sevenZero } });
    };
    const jumpInText = document.createElement('span');
    jumpInText.innerHTML = '<strong>Jump-In:</strong> Play identical card out of turn';
    jumpInLabel.appendChild(jumpInCheckbox);
    jumpInLabel.appendChild(jumpInText);
    jumpInDiv.appendChild(jumpInLabel);
    rulesContainer.appendChild(jumpInDiv);
    
    // 7-0 rule
    const sevenZeroDiv = document.createElement('div');
    sevenZeroDiv.className = 'rule-option';
    const sevenZeroLabel = document.createElement('label');
    sevenZeroLabel.className = 'checkbox-wrapper';
    const sevenZeroCheckbox = document.createElement('input');
    sevenZeroCheckbox.type = 'checkbox';
    sevenZeroCheckbox.id = 'sevenZeroRule';
    sevenZeroCheckbox.checked = currentGameRules.sevenZero;
    sevenZeroCheckbox.onchange = () => {
      currentGameRules.sevenZero = sevenZeroCheckbox.checked;
      socket.emit('setGameRules', { gameId, rules: { stacking: currentGameRules.stacking, jumpIn: currentGameRules.jumpIn, sevenZero: sevenZeroCheckbox.checked } });
    };
    const sevenZeroText = document.createElement('span');
    sevenZeroText.innerHTML = '<strong>7-0 Rule:</strong> 7 swaps hands, 0 rotates hands';
    sevenZeroLabel.appendChild(sevenZeroCheckbox);
    sevenZeroLabel.appendChild(sevenZeroText);
    sevenZeroDiv.appendChild(sevenZeroLabel);
    rulesContainer.appendChild(sevenZeroDiv);
    
    roomControls.appendChild(rulesContainer);
  }

  // Listen for game rules updates from server
  socket.on('gameRulesUpdated', ({ rules }) => {
    if (rules) {
      currentGameRules = { ...currentGameRules, ...rules };
      console.log('Game rules updated:', currentGameRules);
      // Re-render the rules panel if it's visible
      renderRulesPanel();
    }
  });

  // show start button if you're owner
  socket.on('lobbyCreated', ({ gameId: createdId, ownerId, ownerName, isPrivate, joinCode, rules }) => {
    console.log('lobbyCreated event received:', { createdId, ownerId, ownerName, gameId, currentPlayerId });
    if (createdId === gameId) {
      // Set owner info immediately when lobby is created
      if (ownerId) {
        currentOwnerId = ownerId;
        currentOwnerName = ownerName;
        console.log('Lobby created - setting owner:', { ownerId, ownerName, currentPlayerId });
      }
      
      // Set room privacy state and join code
      currentRoomIsPrivate = !!isPrivate;
      if (joinCode) currentJoinCode = joinCode;
      
      // Set game rules if provided
      if (rules) {
        currentGameRules = { ...currentGameRules, ...rules };
      }
      
      // Initialize UI elements
      updateJoinCodeDisplay();
      renderReadyButton();
      renderRulesPanel();
    }
  });

  // Listen for XP gained from server
  socket.on('xpGained', ({ xpAdded, currentXP, level, levelsGained, xpForNextLevel }) => {
    console.log('⭐ XP Gained from server:', { xpAdded, currentXP, level, levelsGained, xpForNextLevel });
    
    // Show XP notification box in upper right corner
    const xpNotification = document.getElementById('xpNotification');
    const xpNotifPlayerName = document.getElementById('xpNotifPlayerName');
    const xpNotifLevel = document.getElementById('xpNotifLevel');
    const xpNotifEarned = document.getElementById('xpNotifEarned');
    
    if (xpNotification && xpNotifPlayerName && xpNotifLevel && xpNotifEarned) {
      console.log('Setting XP notification content...');
      xpNotifPlayerName.textContent = currentUser;
      xpNotifLevel.textContent = level; // Use level from server
      xpNotifEarned.textContent = `+${xpAdded} XP`;
      
      console.log('Displaying XP notification...');
      xpNotification.style.display = 'block';
      xpNotification.style.opacity = '1';
      xpNotification.style.visibility = 'visible';
      
      // Animate in
      setTimeout(() => {
        xpNotification.style.animation = 'slideInRight 0.5s ease-out';
        console.log('XP Notification displayed and animated');
      }, 100);
      
      // Show level up message if they gained levels
      if (levelsGained > 0) {
        console.log(`🎉 Level up! Gained ${levelsGained} level(s). Now level ${level}`);
      }
    } else {
      console.error('XP Notification element not found!');
    }
  });

  // Winner screen handler
  socket.on('showWinnerScreen', ({ winnerName, winnerId, digipogs, playerCount, payoutError = false, selectedTitle, selectedTitleColor }) => {
    console.log('🏆 Winner screen data:', { winnerName, winnerId, digipogs, playerCount, payoutError, selectedTitle, selectedTitleColor });
    
    const modal = document.getElementById('winnerModal');
    const nameDisplay = document.getElementById('winnerNameDisplay');
    const earningsDisplay = document.getElementById('winnerEarningsDisplay');
    const xpDisplay = document.getElementById('winnerXpDisplay');
    
    console.log('XP Display element:', xpDisplay);
    
    const isCurrentUserWinner = winnerName === currentUser;
    
    // Display winner name with title and color
    const displayTitle = selectedTitle || 'Newbie';
    const displayColor = selectedTitleColor || 'white';
    
    if (isCurrentUserWinner) {
      nameDisplay.innerHTML = `<span style="color: ${displayColor}">[${displayTitle}] You are the winner!</span>`;
      
      if (payoutError) {
        // Only show error to the winner
        earningsDisplay.innerHTML = `<strong>Winner!</strong><br><small>Payout processing failed</small>`;
      } else {
        earningsDisplay.innerHTML = `You won <strong>${digipogs}</strong> Digipogs!<br><small>${playerCount} players</small>`;
      }
    } else {
      nameDisplay.innerHTML = `<span style="color: ${displayColor}">[${displayTitle}] ${winnerName}</span> won`;
      earningsDisplay.innerHTML = `<strong>${digipogs}</strong> Digipogs!<br><small>get gud - Try to win next time to earn some!</small>`;
    }
    
    // Note: XP notification is now handled by the xpGained event from the server
    
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
  // socket.on('playAgainPaymentRequired', () => {
  //   console.log('Payment required! Showing payment modal...');
  //   // Close winner modal and XP notification
  //   document.getElementById('winnerModal').style.display = 'none';
  //   const xpNotification = document.getElementById('xpNotification');
  //   if (xpNotification) xpNotification.style.display = 'none';
  //   // Show payment modal
  //   const modal = document.getElementById('paymentModal');
  //   console.log('Payment modal element:', modal);
  //   if (modal) {
  //     modal.style.display = 'block';
  //     console.log('Payment modal should now be visible');
  //   } else {
  //     console.error('Payment modal element not found!');
  //   }
  // });

  // Handle game reset (from play again)
  // socket.on('gameReset', ({ message }) => {
  //   console.log('Game reset:', message);
  //   // Close winner modal and XP notification if still open
  //   document.getElementById('winnerModal').style.display = 'none';
  //   const xpNotification = document.getElementById('xpNotification');
  //   if (xpNotification) xpNotification.style.display = 'none';
  //   // The playerList update will refresh the UI automatically
  // });

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
  // window.addEventListener('paymentSuccess', () => {
  //   console.log('Payment successful! Refreshing payment status...');
  //   hidePaymentModal();
  //   // Request server to refresh payment status
  //   socket.emit('refreshPaymentStatus');
  //   // Wait a brief moment for server to update session, then retry play again
  //   setTimeout(() => {
  //     console.log('Retrying play again after payment...');
  //     socket.emit('playAgain', { gameId });
  //   }, 500);
  // });

  window.addEventListener('hidePaymentModal', () => {
    hidePaymentModal();
  });
});