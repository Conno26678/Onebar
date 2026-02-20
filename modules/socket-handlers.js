const { v4: uuidv4 } = require('uuid');
const { 
  games, 
  generateJoinCode, 
  initGame, 
  clearOnePending, 
  drawFromDeck, 
  getLobbyList,
  shuffle
} = require('./game');
const { createDeck } = require('../cards');
const { processWinnerPayout } = require('./payment');
const db = require('../util/database');

function broadcastLobbyList(io) {
  io.emit('lobbyList', getLobbyList());
}

// Helper to fetch user customization data
function fetchUserCustomization(userId, callback) {
  if (!userId) {
    callback(null, { selectedTitle: 'Newbie', selectedTitleColor: 'white', selectedBadge: 'none', selectedEffect: 'confetti' });
    return;
  }
  db.get('SELECT selectedTitle, selectedTitleColor, selectedBadge, selectedEffect FROM users WHERE id = ?', [userId], (err, row) => {
    if (err || !row) {
      callback(err, { selectedTitle: 'Newbie', selectedTitleColor: 'white', selectedBadge: 'none', selectedEffect: 'confetti' });
    } else {
      callback(null, row);
    }
  });
}

// When emitting playerList, include card counts and ready status:
function emitPlayerList(io, game) {
  const playerData = game.players.map(p => ({
    id: p.id,
    name: p.name,
    cardCount: p.hand ? p.hand.length : 0,
    ready: !!p.ready,
    selectedTitle: p.selectedTitle || 'Newbie',
    selectedTitleColor: p.selectedTitleColor || 'white',
    selectedBadge: p.selectedBadge || 'none'
  }));
  io.to(game.id).emit('playerList', playerData);
}

function startReadyTimeout(io, game, player) {
  // Don't start timeout for owner or if game already started
  if (player.socketId === game.ownerId || game.started) {
    console.log(`Skipping ready timeout for ${player.name} - isOwner: ${player.socketId === game.ownerId}, started: ${game.started}`);
    return;
  }
  
  console.log(`Starting ready timeout for ${player.name} (${player.socketId})`);
  
  // Clear any existing timeout
  if (player.readyTimeout) {
    clearInterval(player.readyCountdown);
    clearTimeout(player.readyTimeout);
  }
  
  const READY_TIMEOUT = 60; // 60 seconds
  player.readyTimeRemaining = READY_TIMEOUT;
  
  // Emit initial countdown value immediately
  io.to(game.id).emit('readyCountdown', {
    playerId: player.id,
    timeRemaining: READY_TIMEOUT
  });
  
  // Send countdown updates every second
  player.readyCountdown = setInterval(() => {
    player.readyTimeRemaining--;
    
    if (player.readyTimeRemaining > 0) {
      io.to(game.id).emit('readyCountdown', {
        playerId: player.id,
        timeRemaining: player.readyTimeRemaining
      });
    } else {
      clearInterval(player.readyCountdown);
      player.readyCountdown = null;
    }
  }, 1000);
  
  // Kick player after timeout
  player.readyTimeout = setTimeout(() => {
    console.log(`Kicking ${player.name} for not readying up`);
    
    // Notify the player they're being kicked
    io.to(player.socketId).emit('kickedForNotReady', {
      reason: 'You were kicked for not readying up within 60 seconds.'
    });
    
    // Remove player from game
    const playerIndex = game.players.findIndex(p => p.id === player.id);
    if (playerIndex !== -1) {
      const [removed] = game.players.splice(playerIndex, 1);
      
      // Clear their timeouts
      if (removed.readyTimeout) clearTimeout(removed.readyTimeout);
      if (removed.readyCountdown) clearInterval(removed.readyCountdown);
      
      // Handle owner transfer if needed
      if (removed.socketId === game.ownerId && game.players.length > 0) {
        game.ownerId = game.players[0].socketId;
        game.ownerName = game.players[0].name;
        game.players[0].ready = true;
        io.to(game.id).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
        if (game.ownerId) {
          io.to(game.ownerId).emit('privateSet', { joinCode: game.joinCode || null });
        }
      }
      
      emitPlayerList(io, game);
      broadcastLobbyList(io);
      
      // Delete game if empty
      if (game.players.length === 0) {
        delete games[game.id];
      }
    }
  }, READY_TIMEOUT * 1000);
}

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    const sess = socket.request && socket.request.session;
    const sessUser = sess && sess.user ? String(sess.user) : 'null';

    console.log('a user connected:', socket.id);

    // Client current lobby list
    socket.emit('lobbyList', getLobbyList());
    
    // Send payment status on connect
    socket.emit('paymentStatus', { hasPaid: !!(sess && sess.hasPaid) });
    
    // Listen for payment status updates from HTTP routes
    socket.on('refreshPaymentStatus', () => {
      // Reload session to get latest hasPaid value
      socket.request.session.reload((err) => {
        if (err) {
          console.error('Session reload error:', err);
          return;
        }
        const updatedSess = socket.request.session;
        socket.emit('paymentStatus', { hasPaid: !!(updatedSess && updatedSess.hasPaid) });
      });
    });

    // =====================
    // LOBBY HANDLERS
    // =====================

    socket.on('createLobby', ({ lobbyName = null, maxPlayers = 8, playerName: clientName = 'Host', isPrivate = false } = {}) => {
      // Reload session to get latest payment status
      socket.request.session.reload((reloadErr) => {
        if (reloadErr) {
          console.error('Session reload error in createLobby:', reloadErr);
          // Fall back to existing session if reload fails
        }
        
        const currentSess = socket.request.session;
        const userId = currentSess?.token?.id;
        
        // Check payment status
        const hasPaid = currentSess && currentSess.hasPaid;
        if (!hasPaid) {
          socket.emit('createLobbyError', { 
            reason: 'Payment required to create lobbies',
            requiresPayment: true 
          });
          return;
        }
        
        const playerName = sessUser || clientName || 'Player';
        const gameId = uuidv4();
        const game = initGame(gameId);
        game.ownerId = socket.id;
        game.ownerName = playerName || 'Host';
        game.lobbyName = lobbyName || `${game.ownerName}'s Lobby`;
        game.maxPlayers = Math.max(2, Math.min(32, Number(maxPlayers) || 8));
        game.createdAt = Date.now();
        game.status = 'waiting';

        if (isPrivate) {
          game.private = true;
          game.joinCode = generateJoinCode(6);
        }

        // Creator auto-joins - fetch customization data
        fetchUserCustomization(userId, (err, customization) => {
          const player = {
            socketId: socket.id,
            id: socket.id,
            name: playerName || 'Host',
            hand: [],
            ready: true,  // Owner is always ready
            userId: userId,
            selectedTitle: customization.selectedTitle,
            selectedTitleColor: customization.selectedTitleColor,
            selectedBadge: customization.selectedBadge,
            selectedEffect: customization.selectedEffect
          };
          game.players.push(player);
          socket.join(gameId);

          // Notify creator (send owner info first)
          socket.emit('lobbyCreated', { gameId, lobbyName: game.lobbyName, isPrivate: game.private, joinCode: game.joinCode, ownerId: game.ownerId, ownerName: game.ownerName, rules: game.rules });
          io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
          emitPlayerList(io, game);
          // Broadcast join code to all players in the room
          io.to(gameId).emit('privateSet', { joinCode: game.joinCode || null });
          broadcastLobbyList(io);

          console.log(`${player.name} created lobby ${gameId} (${game.lobbyName})`);
        });
      });
    });

    // Join by code handler
    socket.on('joinByCode', ({ joinCode, playerName: clientName = 'Player' } = {}) => {
      if (!joinCode) {
        socket.emit('joinByCodeError', { reason: 'No join code provided' });
        return;
      }
      const code = String(joinCode).trim().toUpperCase();
      // Find game with matching join code
      const entry = Object.entries(games).find(([, g]) => g.joinCode && String(g.joinCode).toUpperCase() === code);
      if (!entry) {
        socket.emit('joinByCodeError', { reason: 'Invalid join code' });
        return;
      }
      const [gameId, game] = entry;
      // Now join that lobby
      socket.emit('joinByCodeSuccess', { gameId, lobbyName: game.lobbyName });
    });

    socket.on('joinGame', ({ gameId = 'default', playerName: clientName = 'Player' } = {}) => {
      const game = games[gameId];
      if (!game) {
        socket.emit('joinFailed', { reason: 'Game not found' });
        return;
      }

      const name = (sessUser && String(sessUser)) || clientName || 'Player';

      let player = game.players.find(p => p.name === name);
      let isReconnect = false;
      
      const currentSess = socket.request.session;
      const userId = currentSess && currentSess.token ? currentSess.token.id : null;
      
      if (!player) {
        // New player joining mid-game - only allow if game hasn't started
        if (game.started) {
          socket.emit('joinFailed', { reason: 'Game already in progress' });
          return;
        }
        
        fetchUserCustomization(userId, (err, customization) => {
          player = {
            socketId: socket.id,
            id: socket.id,
            name,
            hand: [],
            ready: false,  // New players start not ready
            userId: userId,
            selectedTitle: customization.selectedTitle,
            selectedTitleColor: customization.selectedTitleColor,
            selectedBadge: customization.selectedBadge,
            selectedEffect: customization.selectedEffect,
            readyTimeout: null,
            readyCountdown: null,
            readyTimeRemaining: null
          };
          game.players.push(player);
          console.log(`New player ${name} joined game ${gameId}`);
          
          // Start ready timeout for new non-owner players
          if (!game.started) {
            startReadyTimeout(io, game, player);
          }
          
          continueJoinGame();
        });
        return;
      } else {
        // Existing player reconnecting - clear any pending disconnect timeout
        isReconnect = true;
        if (player.disconnectTimeout) {
          clearTimeout(player.disconnectTimeout);
          player.disconnectTimeout = null;
          console.log(`Cleared disconnect timeout for ${name} on game rejoin`);
        }
        player.socketId = socket.id;
        player.id = socket.id;
        // Preserve or update userId on reconnect
        if (userId && !player.userId) {
          player.userId = userId;
          console.log(`Set userId ${userId} for reconnecting player ${name}`);
        }
        console.log(`Player ${name} reconnected to game ${gameId} with userId: ${player.userId}`);
      }

      function continueJoinGame() {
        socket.join(gameId);
        socket.emit('joined', { 
          playerId: player.id, 
          gameId, 
          lobbyName: game.lobbyName,
          isPrivate: !!game.private,
          joinCode: null,
          ownerId: game.ownerId,
          ownerName: game.ownerName,
          rules: game.rules || { stacking: false, jumpIn: false, sevenZero: false }
        });

        // Send the player's current hand
        io.to(player.socketId).emit('deal', player.hand);
        io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
        emitPlayerList(io, game);
        // Broadcast join code to all players in the room
        io.to(gameId).emit('privateSet', { joinCode: game.joinCode || null });
        io.to(gameId).emit('drawPileCount', { count: game.deck.length });

        // Restore game state for reconnecting player
        if (game.started) {
          const currentPlayerId = game.players[game.turnIndex]?.id;
          if (currentPlayerId) {
            io.to(player.socketId).emit('turnChanged', { currentPlayerId });
          }
          // Notify client that game is already in progress
          io.to(player.socketId).emit('gameStarted', { 
            currentPlayerId, 
            players: game.players.map(p => ({ id: p.id, name: p.name })) 
          });
        }

        if (game.discardPile && game.discardPile.length > 0) {
          const top = game.discardPile[game.discardPile.length - 1];
          io.to(player.socketId).emit('cardPlacedOnTable', top);
          
          // If it's a wild card without an activeColor and it's this player's turn, ask for color
          // Add a flag to prevent duplicate requests
          if (top.color === 'wild' && !top.activeColor && game.started && !game.awaitingStartColor) {
            const currentPlayer = game.players[game.turnIndex];
            if (currentPlayer && currentPlayer.socketId === socket.id) {
              game.awaitingStartColor = true;
              io.to(socket.id).emit('requestStartColor', { gameId, card: top });
              console.log('Re-requesting starting color after join for', player.name);
            }
          }
        }
      }
      
      continueJoinGame();
    });

    socket.on('joinLobby', ({ gameId = 'default', playerName: clientName = 'Anonymous', joinCode = null } = {}) => {
      const game = games[gameId];
      if (!game) {
        socket.emit('lobbyJoinError', { reason: 'Lobby not found' });
        return;
      }
      if (game.private) {
        // Compare join codes case-insensitively so users can enter lower/upper case
        const provided = (joinCode == null) ? '' : String(joinCode).toUpperCase();
        const expected = String(game.joinCode || '').toUpperCase();
        if (!provided || provided !== expected) {
          socket.emit('lobbyJoinError', { reason: 'Invalid join code for private lobby' });
          return;
        }
      }
      if (game.started) {
        socket.emit('lobbyJoinError', { reason: 'Game already started' });
        return;
      }
      if (game.players.length >= (game.maxPlayers || 8)) {
        socket.emit('lobbyJoinError', { reason: 'Lobby is full' });
        return;
      }

      const playerName = (sessUser && String(sessUser)) || clientName || 'Player';

      const existing = game.players.find(p => p.socketId === socket.id);
      if (existing) {
        socket.join(gameId);
        socket.emit('joined', { 
          playerId: existing.id, 
          gameId, 
          lobbyName: game.lobbyName, 
          isPrivate: !!game.private, 
          joinCode: game.joinCode || null,
          ownerId: game.ownerId,
          ownerName: game.ownerName,
          rules: game.rules || { stacking: false, jumpIn: false, sevenZero: false }
        });
        emitPlayerList(io, game);
        io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
        // Broadcast join code to all players in the room
        io.to(gameId).emit('privateSet', { joinCode: game.joinCode || null });
        broadcastLobbyList(io);
        return;
      }

      const existingByName = game.players.find(p => p.name === playerName);
      if (existingByName) {
        const wasReady = existingByName.ready;
        const isOwner = game.ownerName && game.ownerName === playerName;
        console.log(`Player ${playerName} rejoining: wasReady=${wasReady}, isOwner=${isOwner}`);

        if (existingByName.disconnectTimeout) {
          clearTimeout(existingByName.disconnectTimeout);
          existingByName.disconnectTimeout = null;
          console.log(`Cleared disconnect timeout for ${playerName}`);
        }

        existingByName.socketId = socket.id;
        existingByName.id = socket.id;
        existingByName.userId = socket.request.session.token?.id || existingByName.userId || null;

        // Update owner socket id BEFORE sending events
        if (isOwner) {
          game.ownerId = socket.id;
          existingByName.ready = true;  // Owner is always ready
          console.log(`Owner ${playerName} reconnected, set ready=true`);
        } else {
          existingByName.ready = wasReady;  // Non-owners keep their previous ready state
        }

        socket.join(gameId);
        // Send join code to owner
        socket.emit('joined', { 
          playerId: existingByName.id, 
          gameId, 
          lobbyName: game.lobbyName, 
          isPrivate: !!game.private, 
          joinCode: isOwner ? game.joinCode : null,
          ownerId: game.ownerId,
          ownerName: game.ownerName,
          rules: game.rules || { stacking: false, jumpIn: false, sevenZero: false }
        });

        io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
        io.to(gameId).emit('privateSet', { joinCode: game.joinCode || null });

        // Restart ready timeout for non-ready, non-owner players
        if (!game.started && !isOwner && !existingByName.ready) {
          startReadyTimeout(io, game, existingByName);
        }

        console.log(`After rejoin - Players:`, game.players.map(p => ({ name: p.name, ready: p.ready })));
        emitPlayerList(io, game);
        broadcastLobbyList(io);
        console.log(`${playerName} rejoined lobby ${gameId} (${game.lobbyName})`);
        return;
      }

      const userId = socket.request.session.token?.id || null;
      
      if (!userId) {
        console.warn(`WARNING: Player "${playerName}" joining lobby without userId - they won't be able to receive payouts!`);
      } else {
        console.log(`Player "${playerName}" joining lobby with userId: ${userId}`);
      }
      
      fetchUserCustomization(userId, (err, customization) => {
        const player = {
          socketId: socket.id,
          id: socket.id,
          name: playerName || 'Player',
          userId: userId,
          hand: [],
          ready: false,
          selectedTitle: customization.selectedTitle,
          selectedTitleColor: customization.selectedTitleColor,
          selectedBadge: customization.selectedBadge,
          selectedEffect: customization.selectedEffect,
          readyTimeout: null,
          readyCountdown: null,
          readyTimeRemaining: null
        };
        game.players.push(player);
        socket.join(gameId);
        console.log(`Added player "${player.name}" to lobby (userId: ${userId || 'NONE'})`);
        
        // Start ready timeout for non-owner players
        if (!game.started && socket.id !== game.ownerId) {
          startReadyTimeout(io, game, player);
        }
        
        socket.emit('joined', { 
          playerId: player.id, 
          gameId, 
          lobbyName: game.lobbyName, 
          isPrivate: !!game.private, 
          joinCode: (socket.id === game.ownerId ? game.joinCode : null),
          ownerId: game.ownerId,
          ownerName: game.ownerName,
          rules: game.rules || { stacking: false, jumpIn: false, sevenZero: false }
        });
        console.log(`${player.name} joined as NEW player with ready=false`);
        console.log(`All players now:`, game.players.map(p => ({ name: p.name, ready: p.ready })));
        emitPlayerList(io, game);
        io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
        // If owner changed, send the private join code to that owner (if any)
        if (game.ownerId) {
          io.to(game.ownerId).emit('privateSet', { joinCode: game.joinCode || null });
        }
        broadcastLobbyList(io);

        console.log(`${player.name} joined lobby ${gameId} (${game.lobbyName})`);
      });
    });

    socket.on('setPrivate', ({ gameId, isPrivate = false } = {}) => {
      const game = games[gameId];
      if (!game) return;
      if (socket.id !== game.ownerId) {
        socket.emit('invalidMove', { reason: 'Only owner can change privacy' });
        return;
      }
      game.private = !!isPrivate;
      if (game.private && !game.joinCode) {
        // Only generate a new code if making private and don't have one yet
        game.joinCode = generateJoinCode(6);
      } else if (!game.private) {
        // Clear code when making public
        game.joinCode = null;
      }
      io.to(gameId).emit('privateChanged', { isPrivate: !!game.private });
      io.to(gameId).emit('privateSet', { joinCode: game.joinCode || null });
      broadcastLobbyList(io);
    });

    socket.on('setGameRules', ({ gameId, rules = {} } = {}) => {
      const game = games[gameId];
      if (!game) return;
      if (socket.id !== game.ownerId) {
        socket.emit('invalidMove', { reason: 'Only the host can change game rules' });
        return;
      }
      if (game.started) {
        socket.emit('invalidMove', { reason: 'Cannot change rules after game has started' });
        return;
      }
      
      // Update rules
      if (!game.rules) game.rules = {};
      if (typeof rules.stacking === 'boolean') game.rules.stacking = rules.stacking;
      if (typeof rules.jumpIn === 'boolean') game.rules.jumpIn = rules.jumpIn;
      if (typeof rules.sevenZero === 'boolean') game.rules.sevenZero = rules.sevenZero;
      
      console.log(`Game ${gameId} rules updated:`, game.rules);
      
      // Broadcast updated rules to all players
      io.to(gameId).emit('gameRulesUpdated', { rules: game.rules });
    });

    socket.on('leaveLobby', ({ gameId } = {}) => {
      const game = games[gameId];
      if (!game) return;
      const real = game.players.findIndex(p => p.socketId === socket.id);
      if (real === -1) return;
      const [removed] = game.players.splice(real, 1);
      socket.leave(gameId);
      emitPlayerList(io, game);

      if (removed && removed.socketId === game.ownerId) {
        if (game.players.length > 0) {
          game.ownerId = game.players[0].socketId;
          game.ownerName = game.players[0].name;
          game.players[0].ready = true;  // New owner is always ready
          io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
          if (game.ownerId) {
            io.to(game.ownerId).emit('privateSet', { joinCode: game.joinCode || null });
          }
          emitPlayerList(io, game);  // Update player list to show new owner as ready
        } else {
          delete games[gameId];
        }
      }
      broadcastLobbyList(io);
    });

    socket.on('setReady', ({ gameId = 'default', ready = false } = {}) => {
      const game = games[gameId];
      if (!game) return;
      const real = game.players.findIndex(p => p.socketId === socket.id);
      if (real === -1) return;
      
      // Don't allow owner to change ready state - they're always ready
      if (game.players[real].socketId === game.ownerId) {
        console.log(`Owner ${game.players[real].name} cannot change ready state - always ready`);
        return;
      }
      
      console.log(`Player ${game.players[real].name} setting ready to ${ready}`);
      game.players[real].ready = !!ready;
      
      // Clear ready timeout if player readied up
      if (ready && game.players[real].readyTimeout) {
        clearInterval(game.players[real].readyCountdown);
        clearTimeout(game.players[real].readyTimeout);
        game.players[real].readyTimeout = null;
        game.players[real].readyCountdown = null;
        game.players[real].readyTimeRemaining = null;
      }
      
      // Start ready timeout if player unreadied
      if (!ready && !game.started) {
        startReadyTimeout(io, game, game.players[real]);
      }
      
      console.log(`All players now:`, game.players.map(p => ({ name: p.name, ready: p.ready })));
      emitPlayerList(io, game);
      // Broadcast join code to all players in the room
      io.to(gameId).emit('privateSet', { joinCode: game.joinCode || null });
      broadcastLobbyList(io);
    });

    // =====================
    // GAME HANDLERS
    // =====================

    socket.on('startGame', ({ gameId = 'default', handSize = 7 } = {}) => {
      const game = games[gameId] || initGame(gameId);
      if (!game) return;

      console.log('=== START GAME REQUEST ===');
      console.log('Game ID:', gameId);
      console.log('Owner ID:', game.ownerId);
      console.log('Socket ID:', socket.id);
      console.log('Players:', game.players.map(p => ({ name: p.name, id: p.id, ready: p.ready })));

      if (socket.id !== game.ownerId) {
        socket.emit('invalidMove', { reason: 'Only the lobby owner can start the game' });
        return;
      }
      const notReady = game.players.some(p => !p.ready);
      if (notReady) {
        console.log('START FAILED: Not all players ready');
        socket.emit('invalidMove', { reason: 'Not all players are ready' });
        return;
      }
      if (game.started) return;
      if (game.players.length === 0) return;

      handSize = Number(handSize) || 7;
      if (handSize < 1) handSize = 1;

      if (game.players.length > (game.maxPlayers || 32)) {
        socket.emit('invalidMove', { reason: 'Too many players to start' });
        return;
      }

      shuffle(game.deck);
      for (const player of game.players) {
        player.hand = game.deck.splice(0, handSize);
        io.to(player.socketId).emit('deal', player.hand);
      }
      emitPlayerList(io, game);

      if (game.deck.length > 0) {
        const top = game.deck.pop();
        game.discardPile = [top];
      } else {
        game.discardPile = [];
      }

      io.to(gameId).emit('drawPileCount', { count: game.deck.length });

      game.turnIndex = 0;
      game.started = true;
      
      // Clear all ready timeouts since game is starting
      for (const player of game.players) {
        if (player.readyTimeout) {
          clearTimeout(player.readyTimeout);
          player.readyTimeout = null;
        }
        if (player.readyCountdown) {
          clearInterval(player.readyCountdown);
          player.readyCountdown = null;
        }
        player.readyTimeRemaining = null;
      }

      const currentPlayerId = game.players[game.turnIndex].id;
      const currentSocketId = game.players[game.turnIndex].socketId;
      io.to(gameId).emit('gameStarted', { currentPlayerId, players: game.players.map(p => ({ id: p.id, name: p.name })) });

      if (game.discardPile.length > 0) {
        const top = game.discardPile[game.discardPile.length - 1];

        io.to(gameId).emit('cardPlacedOnTable', top);

        if (top.color === 'wild') {
          game.awaitingStartColor = true;
          io.to(currentSocketId).emit('requestStartColor', { gameId, card: top });
          console.log('requesting starting color', currentSocketId);
          
          // Auto-set to red after 10 seconds if no response
          setTimeout(() => {
            if (game.awaitingStartColor && game.discardPile.length > 0) {
              const currentTop = game.discardPile[game.discardPile.length - 1];
              if (currentTop.color === 'wild' && !currentTop.activeColor) {
                console.log(`⏰ Auto-setting start color to red after timeout for game ${gameId}`);
                currentTop.activeColor = 'red';
                game.awaitingStartColor = false;
                io.to(gameId).emit('cardPlacedOnTable', currentTop);
                const turnPlayer = game.players[game.turnIndex];
                if (turnPlayer) {
                  io.to(gameId).emit('turnChanged', { currentPlayerId: turnPlayer.id });
                }
              }
            }
          }, 10000);
        }
      }

      console.log('game started', gameId);
    });

    socket.on('drawCard', ({ gameId = 'default', count = 1 } = {}) => {
      const game = games[gameId];
      if (!game || !game.started) {
        socket.emit('invalidMove', { reason: 'Game not started' });
        return;
      }
      
      // Block moves if awaiting start color selection
      if (game.awaitingStartColor) {
        socket.emit('invalidMove', { reason: 'Waiting for starting color to be chosen' });
        return;
      }
      
      const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex === -1) {
        socket.emit('invalidMove', { reason: 'Not in game' });
        return;
      }
      if (playerIndex !== game.turnIndex) {
        socket.emit('invalidMove', { reason: 'Not your turn' });
        return;
      }

      const player = game.players[playerIndex];
      
      // Prevent drawing if there's already a pending drawn card decision
      if (game.pendingDrawnCard && game.pendingDrawnCard.playerId === player.id) {
        socket.emit('invalidMove', { reason: 'Must decide on current drawn card first' });
        return;
      }

      // Check if there's a draw stack from stacking rule
      let drawCount = count || 1;
      if (game.rules && game.rules.stacking && game.drawStack > 0) {
        console.log(`Player ${player.name} drawing from stack: ${game.drawStack} cards`);
        drawCount = game.drawStack;
        game.drawStack = 0;  // Reset the stack
        io.to(gameId).emit('drawStackUpdated', { drawStack: 0 });
        
        // When drawing from stack, draw all cards and skip turn
        const stackDrawn = drawFromDeck(game, drawCount);
        player.hand.push(...stackDrawn);
        io.to(player.socketId).emit('deal', player.hand);
        io.to(gameId).emit('playerDrewCards', { playerId: player.id, count: stackDrawn.length });
        io.to(gameId).emit('drawPileCount', { count: game.deck.length });
        emitPlayerList(io, game);
        
        // Advance turn
        const playerCount = game.players.length;
        const step = game.direction;
        const nextIndex = ((game.turnIndex + step) % playerCount + playerCount) % playerCount;
        game.turnIndex = nextIndex;
        const nextPlayerId = game.players[game.turnIndex].id;
        io.to(gameId).emit('turnChanged', { currentPlayerId: nextPlayerId });
        return;
      }

      const drawn = drawFromDeck(game, 1);
      if (!drawn || drawn.length === 0) {
        socket.emit('invalidMove', { reason: 'No cards left to draw' });
        return;
      }

      const drawnCard = drawn[0];

      //Drawn card playable logic
      const topCard = game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : null;
      const topActiuveColor = topCard ? (topCard.activeColor || topCard.color) : null;

      const isWild = drawnCard.color === 'wild';
      const matchesColor = topActiuveColor && drawnCard.color === topActiuveColor;
      const matchesValue = topCard && String(drawnCard.value) === String(topCard.value);
      const isPlayable = !topCard || isWild || matchesColor || matchesValue;

      if (isPlayable) {
        //store temp until they choose to play or keep
        game.pendingDrawnCard = {
          playerId: player.id,
          card: drawnCard
        };
        io.to(player.socketId).emit('drawnCardPlayable', {
          card: drawnCard,
          gameId,
          isWild
        });
        io.to(gameId).emit('drawPileCount', { count: game.deck.length });
      } else {
        //card not playable, auto add to hand
        player.hand.push(drawnCard);
        io.to(player.socketId).emit('deal', player.hand);
        io.to(gameId).emit('playerDrew', { playerId: player.id, count: 1});
        io.to(gameId).emit('drawPileCount', { count: game.deck.length });
        emitPlayerList(io, game);

        //turn advances
        const playerCount = game.players.length;
        const step = game.direction;
        const nextIndex = ((game.turnIndex + step) % playerCount + playerCount) % playerCount;
        game.turnIndex = nextIndex;

        const nextPlayerId = game.players[game.turnIndex].id;
        io.to(gameId).emit('turnChanged', { currentPlayerId: nextPlayerId });
      }
      });

      socket.on('drawnCardChoice', ({ gameId = 'default',  action, chosenColor } = {}) => {
        const game = games[gameId];
        if (!game || !game.started) return;

        const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
        if (playerIndex === -1) return;

        const player = game.players[playerIndex];

        //verify drawn card
        if (!game.pendingDrawnCard || game.pendingDrawnCard.playerId !== player.id) {
          socket.emit('invalidMove', { reason: 'No pending drawn card to act upon' });
          return;
        }

        const card = game.pendingDrawnCard.card;
        game.pendingDrawnCard = null;

        if (action === 'keep') {
          //add to hand
          player.hand.push(card);
          io.to(player.socketId).emit('deal', player.hand);
          io.to(gameId).emit('playerDrew', { playerId: player.id, count: 1 });
          emitPlayerList(io, game);

          //turn advances
          const playerCount = game.players.length;
          const step = game.direction;
          const nextIndex = ((game.turnIndex + step) % playerCount + playerCount) % playerCount;
          game.turnIndex = nextIndex;

          const nextPlayerId = game.players[game.turnIndex].id;
          io.to(gameId).emit('turnChanged', { currentPlayerId: nextPlayerId });
        } else if (action === 'play') {
          //play the card
          const isWild = card.color === 'wild';
          if (isWild) {
            const allowed = ['red', 'green', 'blue', 'yellow'];
            if (!chosenColor || !allowed.includes(String(chosenColor).toLowerCase())) {
              chosenColor = 'red';
            } else {
              chosenColor = String(chosenColor).toLowerCase();
            }
            card.activeColor = chosenColor;
          } else {
            card.activeColor = card.color;
          }

          game.discardPile.push(card);
          io.to(gameId).emit('cardPlayed', { playerId: player.id, playerName: player.name, card });

          const playerCount = game.players.length;
          const step = game.direction;
          let nextIndex = ((playerIndex + step) % playerCount + playerCount) % playerCount;

          const special = String(card.value).toLowerCase();

          //Handles special cards
          if (special === 'skip' || special === 'skip_2') {
            nextIndex = ((nextIndex + step) % playerCount + playerCount) % playerCount;
          } else if (
            special === 'wild draw four' ||
            special === 'wild_draw_four' ||
            special.includes('draw four') ||
            special.includes('draw_four') ||
            special.includes('wild draw')
          ) {
            const victim = game.players[nextIndex]; 
            const drawnCards = drawFromDeck(game, 4);
            victim.hand.push(...drawnCards);
            io.to(victim.socketId).emit('deal', victim.hand);
            io.to(gameId).emit('playerDrewCards', { playerId: victim.id, count: drawnCards.length });
            nextIndex = ((nextIndex + step) % playerCount + playerCount) % playerCount;
          } else if (
            special === 'draw two' ||
            special === 'draw_two' ||
            special.includes('draw two') ||
            special.includes('draw_two')
          ) {
            const victim = game.players[nextIndex];
            const drawnCards = drawFromDeck(game, 2);
            victim.hand.push(...drawnCards);
            io.to(victim.socketId).emit('deal', victim.hand);
            io.to(gameId).emit('playerDrewCards', { playerId: victim.id, count: drawnCards.length });
            nextIndex = ((nextIndex + step) % playerCount + playerCount) % playerCount;
          } else if (special === 'reverse') {
            game.direction = -game.direction;
            if (playerCount === 2) {
              nextIndex = playerIndex;
            } else {
              nextIndex = ((playerIndex + game.direction) % playerCount + playerCount) % playerCount;
            }
          }

          game.turnIndex = nextIndex;

          const nextPlayerId = game.players[game.turnIndex].id;
          io.to(gameId).emit('turnChanged', { currentPlayerId: nextPlayerId });
          io.to(gameId).emit('drawPileCount', { count: game.deck.length });
          emitPlayerList(io, game);
        }
    });

    socket.on('startColorChosen', ({ gameId = 'default', color } = {}) => {
      const game = games[gameId];
      if (!game) return;
      if (!game.discardPile || game.discardPile.length === 0) return;
      const top = game.discardPile[game.discardPile.length - 1];
      if (top.color !== 'wild' || top.activeColor) return;

      const currentPlayer = game.players[game.turnIndex];
      if (!currentPlayer || currentPlayer.socketId !== socket.id) {
        socket.emit('invalidMove', { reason: 'Not authorized to choose start color' });
        return;
      }

      const allowed = ['red', 'green', 'blue', 'yellow'];
      if (!color || !allowed.includes(String(color).toLowerCase())) {
        color = 'red';
      } else {
        color = String(color).toLowerCase();
      }

      top.activeColor = color;
      game.started = true;
      game.awaitingStartColor = false;

      io.to(gameId).emit('cardPlacedOnTable', top);
      io.to(gameId).emit('turnChanged', { currentPlayerId: currentPlayer.id });

      console.log(`Start color chosen for game ${gameId}: ${color}`);
    });

    // Handle player choosing who to swap hands with (7 card rule)
    socket.on('chooseSwapTarget', ({ gameId = 'default', targetPlayerId } = {}) => {
      const game = games[gameId];
      if (!game || !game.started) {
        socket.emit('invalidMove', { reason: 'Game not started' });
        return;
      }

      if (!game.awaitingSevenSwap || game.awaitingSevenSwap.playerId !== socket.id) {
        socket.emit('invalidMove', { reason: 'Not awaiting swap choice' });
        return;
      }

      const player = game.players.find(p => p.socketId === socket.id);
      const targetPlayer = game.players.find(p => p.id === targetPlayerId);

      if (!player || !targetPlayer) {
        socket.emit('invalidMove', { reason: 'Player not found' });
        return;
      }

      if (player.id === targetPlayer.id) {
        socket.emit('invalidMove', { reason: 'Cannot swap with yourself' });
        return;
      }

      console.log(`Swapping hands between ${player.name} and ${targetPlayer.name}`);

      // Swap the hands
      const tempHand = player.hand;
      player.hand = targetPlayer.hand;
      targetPlayer.hand = tempHand;

      // Send updated hands to both players
      io.to(player.socketId).emit('deal', player.hand);
      io.to(targetPlayer.socketId).emit('deal', targetPlayer.hand);

      // Notify all players about the swap
      io.to(gameId).emit('handsSwapped', {
        player1: { id: player.id, name: player.name },
        player2: { id: targetPlayer.id, name: targetPlayer.name }
      });

      // Update player list for everyone
      emitPlayerList(io, game);

      // Clear the awaiting swap state
      delete game.awaitingSevenSwap;

      // Now advance the turn
      const playerIndex = game.players.findIndex(p => p.id === player.id);
      const playerCount = game.players.length;
      const step = game.direction;
      const nextIndex = ((playerIndex + step) % playerCount + playerCount) % playerCount;
      game.turnIndex = nextIndex;

      const nextPlayerId = game.players[game.turnIndex].id;
      io.to(gameId).emit('turnChanged', { currentPlayerId: nextPlayerId });
      io.to(gameId).emit('drawPileCount', { count: game.deck.length });

      console.log(`Hands swapped. Turn advances to ${game.players[game.turnIndex].name}`);
    });

    socket.on('playCard', ({ gameId = 'default', cardId, chosenColor } = {}) => {
      const game = games[gameId];
      if (!game || !game.started) {
        socket.emit('invalidMove', { reason: 'Game not started' });
        return;
      }

      // Block moves if awaiting start color selection
      if (game.awaitingStartColor) {
        socket.emit('invalidMove', { reason: 'Waiting for starting color to be chosen' });
        return;
      }

      const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex === -1) {
        socket.emit('invalidMove', { reason: 'Not in game' });
        return;
      }
      if (playerIndex !== game.turnIndex) {
        socket.emit('invalidMove', { reason: 'Not your turn' });
        return;
      }
      const player = game.players[playerIndex];
      const cardIndex = player.hand.findIndex(c => c.id === cardId);
      if (cardIndex === -1) {
        socket.emit('invalidMove', { reason: 'Card not in hand' });
        return;
      }

      // Block playing last card (winning) if player has 1 card and hasn't called ONE
      if (player.hand.length === 1 && !player.calledOne) {
        // Clear any existing ONE penalty timer to avoid double-penalizing
        if (game.onePending && game.onePending.playerId === player.id) {
          clearOnePending(game);
        }
        
        // Penalize: give them 2 cards and reject the play
        const penaltyCards = drawFromDeck(game, 2);
        player.hand.push(...penaltyCards);
        io.to(player.socketId).emit('deal', player.hand);
        socket.emit('invalidMove', { reason: 'You must call ONE before playing your last card!' });
        io.to(gameId).emit('playerPenalized', { 
          playerId: player.id, 
          playerName: player.name, 
          count: penaltyCards.length,
          reason: 'noOneCalled'
        });
        io.to(gameId).emit('drawPileCount', { count: game.deck.length });
        emitPlayerList(io, game);
        console.log(`Player ${player.name} tried to play last card without calling ONE - drew ${penaltyCards.length} penalty cards`);
        return;
      }

      const [card] = player.hand.splice(cardIndex, 1);
      
      // Reset calledOne after playing a card
      player.calledOne = false;
      
      const topCard = game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : null;
      const topActiveColor = topCard ? (topCard.activeColor || topCard.color) : null;

      const isWild = card.color === 'wild';
      const matchesColor = topActiveColor && card.color === topActiveColor;
      const matchesValue = topCard && String(card.value) === String(topCard.value);
      const isValidPlay = !topCard || isWild || matchesColor || matchesValue;
      if (!isValidPlay) {
        player.hand.push(card);
        socket.emit('invalidMove', { reason: 'Card doesnt match color or value twin' });
        // Resend the hand so the client has the correct state
        io.to(player.socketId).emit('deal', player.hand);
        return;
      }

      if (isWild) {
        const allowed = ['red', 'green', 'blue', 'yellow'];
        if (!chosenColor || !allowed.includes(String(chosenColor).toLowerCase())) {
          chosenColor = 'red';
        } else {
          chosenColor = String(chosenColor).toLowerCase();
        }
        card.activeColor = chosenColor;
      } else {
        card.activeColor = card.color;
      }

      game.discardPile.push(card);
      io.to(gameId).emit('cardPlayed', { playerId: player.id, playerName: player.name, card });

      const playerCount = game.players.length;
      const step = game.direction;
      let nextIndex = ((playerIndex + step) % playerCount + playerCount) % playerCount;

      const special = String(card.value).toLowerCase();
      const isDrawCard = special.includes('draw');
      const isDrawTwo = special === 'draw two' || special === 'draw_two' || special.includes('draw two') || special.includes('draw_two');
      const isDrawFour = special === 'wild draw four' || special === 'wild_draw_four' || special.includes('draw four') || special.includes('draw_four') || special.includes('wild draw');

      // Initialize draw stack if not present
      if (typeof game.drawStack !== 'number') game.drawStack = 0;

      // SKIP
      if (special === 'skip' || special === 'skip_2') {
        nextIndex = ((nextIndex + step) % playerCount + playerCount) % playerCount;

      // DRAW CARDS - with stacking support
      } else if (isDrawTwo || isDrawFour) {
        const drawAmount = isDrawFour ? 4 : 2;
        
        if (game.rules && game.rules.stacking) {
          // Stacking enabled - add to stack
          game.drawStack += drawAmount;
          console.log(`Stacking enabled: Added ${drawAmount} to draw stack. Total: ${game.drawStack}`);
          io.to(gameId).emit('drawStackUpdated', { drawStack: game.drawStack });
          // Don't skip turn - next player can stack or draw
        } else {
          // No stacking - victim draws immediately
          const victim = game.players[nextIndex];
          const drawn = drawFromDeck(game, drawAmount);
          victim.hand.push(...drawn);
          io.to(victim.socketId).emit('deal', victim.hand);
          io.to(gameId).emit('playerDrewCards', { playerId: victim.id, count: drawn.length });
          nextIndex = ((nextIndex + step) % playerCount + playerCount) % playerCount;
        }

      // REVERSE
      } else if (special === 'reverse') {
        game.direction = -game.direction;
        if (playerCount === 2) {
          nextIndex = playerIndex;
        } else {
          nextIndex = ((playerIndex + game.direction) % playerCount + playerCount) % playerCount;
        }
      
      // 7-0 RULE: Handle 7 (swap hands) and 0 (rotate hands)
      } else if (game.rules && game.rules.sevenZero && (card.value === 7 || card.value === '7' || card.value === 0 || card.value === '0')) {
        if (card.value === 7 || card.value === '7') {
          // SEVEN: Player chooses someone to swap hands with
          console.log(`Player ${player.name} played a 7 - initiating hand swap choice`);
          
          // Get list of other players with their card counts
          const otherPlayers = game.players
            .filter(p => p.id !== player.id)
            .map(p => ({
              id: p.id,
              name: p.name,
              cardCount: p.hand.length
            }));
          
          // Store the game state to process the swap later
          game.awaitingSevenSwap = {
            playerId: player.id,
            playerName: player.name
          };
          
          // Ask the player who played the 7 to choose someone
          io.to(player.socketId).emit('choosePlayerForSwap', {
            players: otherPlayers
          });
          
          // Don't advance turn yet - will advance after swap is chosen
          return; // Exit early, turn will be advanced in swapHands handler
          
        } else if (card.value === 0 || card.value === '0') {
          // ZERO: Rotate hands in the direction of play
          console.log(`Player ${player.name} played a 0 - rotating all hands`);
          
          if (playerCount > 1) {
            // Store all hands temporarily
            const hands = game.players.map(p => p.hand);
            
            // Rotate hands in the direction of play
            if (game.direction === 1) {
              // Clockwise: each player gets the previous player's hand
              for (let i = 0; i < playerCount; i++) {
                const prevIndex = (i - 1 + playerCount) % playerCount;
                game.players[i].hand = hands[prevIndex];
              }
            } else {
              // Counter-clockwise: each player gets the next player's hand
              for (let i = 0; i < playerCount; i++) {
                const nextIdx = (i + 1) % playerCount;
                game.players[i].hand = hands[nextIdx];
              }
            }
            
            // Send updated hands to all players
            game.players.forEach(p => {
              io.to(p.socketId).emit('deal', p.hand);
            });
            
            // Notify all players about the rotation
            io.to(gameId).emit('handsRotated', {
              playerId: player.id,
              playerName: player.name,
              direction: game.direction === 1 ? 'clockwise' : 'counter-clockwise'
            });
            
            console.log(`Hands rotated ${game.direction === 1 ? 'clockwise' : 'counter-clockwise'}`);
          }
        }
      } else {
        // Regular card played - reset draw stack if stacking was active
        if (game.drawStack > 0) {
          console.log(`Regular card played, resetting draw stack from ${game.drawStack} to 0`);
          game.drawStack = 0;
          io.to(gameId).emit('drawStackUpdated', { drawStack: 0 });
        }
      }

      game.turnIndex = nextIndex;

      const nextPlayerId = game.players[game.turnIndex].id;
      io.to(gameId).emit('turnChanged', { currentPlayerId: nextPlayerId });
      io.to(gameId).emit('drawPileCount', { count: game.deck.length });
      emitPlayerList(io, game);

      // ONE timer logic - when player goes down to 1 card, start 5 second timer
      if (player.hand.length === 1) {
        // Clear any existing pending ONE for this player
        if (game.onePending && game.onePending.playerId === player.id) {
          clearOnePending(game);
        }
        
        const penaltyDelayMs = 5000;
        const timeoutId = setTimeout(() => {
          if (!game.onePending || game.onePending.playerId !== player.id) return;
          // Player didn't call ONE in time - penalize
          const drawn = drawFromDeck(game, 2);
          player.hand.push(...drawn);
          io.to(player.socketId).emit('deal', player.hand);
          io.to(gameId).emit('playerPenalized', { 
            playerId: player.id, 
            playerName: player.name, 
            count: drawn.length,
            reason: 'timeout'
          });
          io.to(gameId).emit('drawPileCount', { count: game.deck.length });
          emitPlayerList(io, game);
          clearOnePending(game);
          console.log(`Player ${player.name} failed to call ONE in time - drew ${drawn.length} penalty cards`);
        }, penaltyDelayMs);

        game.onePending = {
          playerId: player.id,
          timeoutId,
          expiresAt: Date.now() + penaltyDelayMs
        };

        // Notify the player they need to call ONE
        io.to(player.socketId).emit('youHaveOne', { expiresAt: game.onePending.expiresAt });
      }

      // Win detection
      if (player.hand.length === 0) {
        if (game.onePending && game.onePending.playerId === player.id) clearOnePending(game);

        game.started = false;
        game.winner = { id: player.id, name: player.name, timestamp: Date.now() };

        io.to(gameId).emit('playerWon', { 
          playerId: player.id, 
          playerName: player.name,
          selectedTitle: player.selectedTitle || 'Newbie',
          selectedTitleColor: player.selectedTitleColor || 'white'
        });
        io.to(gameId).emit('gameEnded', {
          winner: { 
            id: player.id, 
            name: player.name,
            selectedTitle: player.selectedTitle || 'Newbie',
            selectedTitleColor: player.selectedTitleColor || 'white'
          },
          players: game.players.map(p => ({ id: p.id, name: p.name, handCount: p.hand.length })),
          discardTop: game.discardPile[game.discardPile.length - 1] || null
        });

        console.log(`Player ${player.name} (${player.id}) won game ${gameId}`);
        
        // Calculate player count for XP calculation
        const playerCount = game.players.length;
        
        // Update game statistics for all players
        game.players.forEach(p => {
          if (p.userId) {
            const isWinner = p.id === player.id;
            
            // Update wins/losses/games played
            if (isWinner) {
              db.run("UPDATE users SET wins = COALESCE(wins, 0) + 1, gamesPlayed = COALESCE(gamesPlayed, 0) + 1 WHERE id = ?", [p.userId], (err) => {
                if (err) console.error('Database error updating winner stats:', err);
              });
              
              // Award XP to winner - matches client-side formula: 150 + (playerCount * 25)
              const totalXP = 150 + (playerCount * 25);
              
              db.addXP(p.userId, totalXP, (xpErr, xpResult) => {
                if (xpErr) {
                  console.error('Error adding XP to winner:', xpErr);
                } else {
                  console.log(`Winner ${p.name} earned ${totalXP} XP. New level: ${xpResult.level}, XP: ${xpResult.xp}`);
                  if (xpResult.levelsGained > 0) {
                    console.log(`🎉 ${p.name} leveled up ${xpResult.levelsGained} time(s)!`);
                  }
                  // Emit XP gain to the winner
                  io.to(p.socketId).emit('xpGained', {
                    xpAdded: totalXP,
                    currentXP: xpResult.xp,
                    level: xpResult.level,
                    levelsGained: xpResult.levelsGained,
                    xpForNextLevel: xpResult.xpForNextLevel
                  });
                }
              });
            } else {
              db.run("UPDATE users SET losses = COALESCE(losses, 0) + 1, gamesPlayed = COALESCE(gamesPlayed, 0) + 1 WHERE id = ?", [p.userId], (err) => {
                if (err) console.error('Database error updating loser stats:', err);
              });
              
              // Award participation XP to losers - matches client-side formula: 25 + (playerCount * 5)
              const totalXP = 25 + (playerCount * 5);
              
              db.addXP(p.userId, totalXP, (xpErr, xpResult) => {
                if (xpErr) {
                  console.error('Error adding XP to loser:', xpErr);
                } else {
                  console.log(`Player ${p.name} earned ${totalXP} participation XP. New level: ${xpResult.level}, XP: ${xpResult.xp}`);
                  if (xpResult.levelsGained > 0) {
                    console.log(`🎉 ${p.name} leveled up ${xpResult.levelsGained} time(s)!`);
                  }
                  // Emit XP gain to the loser
                  io.to(p.socketId).emit('xpGained', {
                    xpAdded: totalXP,
                    currentXP: xpResult.xp,
                    level: xpResult.level,
                    levelsGained: xpResult.levelsGained,
                    xpForNextLevel: xpResult.xpForNextLevel
                  });
                }
              });
            }
            
            // Reset payment status for all players EXCEPT owner (ID 33)
            if (p.userId !== 33) {
              console.log(`Resetting payment status for player ${p.name} (userId: ${p.userId})`);
              const socketForPlayer = io.sockets.sockets.get(p.socketId);
              if (socketForPlayer && socketForPlayer.request && socketForPlayer.request.session) {
                socketForPlayer.request.session.hasPaid = false;
                socketForPlayer.request.session.save((err) => {
                  if (err) {
                    console.error('Session save error for player:', err);
                  } else {
                    console.log(`Session saved, hasPaid=false for ${p.name}`);
                  }
                  // Emit updated payment status to the player
                  socketForPlayer.emit('paymentStatus', { hasPaid: false });
                  console.log(`Emitted paymentStatus { hasPaid: false } to ${p.name}`);
                });
              }
              // Also reset in database
              db.run("UPDATE users SET hasPaid = 0 WHERE id = ?", [p.userId], (err) => {
                if (err) {
                  console.error('Database error resetting hasPaid:', err);
                } else {
                  console.log(`Database updated: hasPaid=0 for userId ${p.userId}`);
                }
              });
            } else {
              console.log(`Skipping payment reset for owner (userId: ${p.userId})`);
            }
          }
        });
        
        // Process winner payout with dynamic amount calculation
        const winnerId = player.userId;
        
        console.log(`GAME OVER - Winner: ${player.name}, userId: ${winnerId || 'NONE'}, playerCount: ${playerCount}`);
        
        if (winnerId) {
          console.log(`Initiating payout: winner userId=${winnerId}, players=${playerCount}`);
          
          processWinnerPayout(winnerId, playerCount, gameId, game.lobbyName)
            .then(result => {
              if (result.ok) {
                console.log(`Payout success: ${result.amount} Digipogs to user ${winnerId}`);
                
                // Emit winner screen to all players in the room
                io.to(gameId).emit('showWinnerScreen', {
                  winnerName: player.name,
                  winnerId: player.id,
                  digipogs: result.amount,
                  playerCount: playerCount,
                  selectedTitle: player.selectedTitle || 'Newbie',
                  selectedTitleColor: player.selectedTitleColor || 'white',
                  selectedEffect: player.selectedEffect || 'confetti'
                });
                
                io.to(player.socketId).emit('payoutSuccess', {
                  amount: result.amount,
                  playerCount: playerCount,
                  message: `You won ${result.amount} Digipogs! (${playerCount} players)`
                });
              } else {
                console.error(`Payout failed for user ${winnerId}:`, result.error);
                
                // Still show winner screen even if payout failed
                io.to(gameId).emit('showWinnerScreen', {
                  winnerName: player.name,
                  winnerId: player.id,
                  digipogs: 0,
                  playerCount: playerCount,
                  payoutError: true,
                  payoutErrorMessage: result.error || 'Failed to process winner payout',
                  selectedTitle: player.selectedTitle || 'Newbie',
                  selectedTitleColor: player.selectedTitleColor || 'white',
                  selectedEffect: player.selectedEffect || 'confetti'
                });
                
                io.to(player.socketId).emit('payoutFailed', {
                  error: result.error,
                  message: 'Failed to process winner payout. Please contact support.'
                });
              }
            })
            .catch(err => {
              console.error('Payout processing error:', err);
              
              // Still show winner screen even if payout failed
              io.to(gameId).emit('showWinnerScreen', {
                winnerName: player.name,
                winnerId: player.id,
                digipogs: 0,
                playerCount: playerCount,
                payoutError: true,
                payoutErrorMessage: err?.message || 'Unexpected error processing payout',
                selectedTitle: player.selectedTitle || 'Newbie',
                selectedTitleColor: player.selectedTitleColor || 'white',
                selectedEffect: player.selectedEffect || 'confetti'
              });
              
              io.to(player.socketId).emit('payoutFailed', {
                error: 'Unexpected error',
                message: 'Failed to process payout. Please contact support.'
              });
            });
        } else {
          console.warn(`WARNING: Winner "${player.name}" has no userId (winnerId=${winnerId}), cannot process payout`);
          console.log(`Player object:`, { name: player.name, userId: player.userId, socketId: player.socketId });
          
          // Show winner screen without payout info
          io.to(gameId).emit('showWinnerScreen', {
            winnerName: player.name,
            winnerId: player.id,
            digipogs: 0,
            playerCount: playerCount,
            payoutError: true,
            payoutErrorMessage: 'Winner has no user account linked',
            selectedTitle: player.selectedTitle || 'Newbie',
            selectedTitleColor: player.selectedTitleColor || 'white',
            selectedEffect: player.selectedEffect || 'confetti'
          });
          
          io.to(player.socketId).emit('payoutFailed', {
            error: 'No user ID',
            message: 'Cannot process payout: user not authenticated'
          });
        }
        
        return;
      }
    });

    socket.on('callOne', ({ gameId = 'default' } = {}) => {
      const game = games[gameId];
      if (!game) {
        socket.emit('invalidOneCall', { reason: 'Game not found' });
        return;
      }
      const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex === -1) {
        socket.emit('invalidOneCall', { reason: 'Not in game' });
        return;
      }
      const player = game.players[playerIndex];
      if (!player || player.hand.length !== 1) {
        socket.emit('invalidOneCall', { reason: 'You do not have exactly one card' });
        return;
      }

      // Mark that player has called ONE - allows them to play their last card
      player.calledOne = true;

      // Clear the penalty timer
      if (game.onePending && game.onePending.playerId === player.id) {
        clearOnePending(game);
      }

      // Emit immediately to show game info right away
      const playerInfo = game.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length
      }));
      
      io.to(gameId).emit('playerCalledOne', { playerId: player.id, playerName: player.name });
      io.to(gameId).emit('playerList', playerInfo);
    });

    // =====================
    // PLAY AGAIN HANDLER
    // =====================

    socket.on('playAgain', ({ gameId } = {}) => {
      const game = games[gameId];
      if (!game) {
        socket.emit('invalidMove', { reason: 'Game not found' });
        return;
      }

      console.log(`Play Again requested for game ${gameId}`);

      // Check if the player has paid
      socket.request.session.reload((reloadErr) => {
        if (reloadErr) {
          console.error('Session reload error in playAgain:', reloadErr);
        }
        
        const currentSess = socket.request.session;
        const hasPaid = currentSess && currentSess.hasPaid;
        const userId = currentSess && currentSess.token ? currentSess.token.id : null;
        
        console.log(`Play Again check: userId=${userId}, hasPaid=${hasPaid}, socketId=${socket.id}`);
        
        if (!hasPaid) {
          // Emit event to show payment modal
          console.log(`💰 Payment required for play again - emitting playAgainPaymentRequired to ${socket.id}`);
          socket.emit('playAgainPaymentRequired');
          return;
        }

        console.log(`✅ Payment verified, resetting game ${gameId}`);

        // Reset game state while keeping players
        game.deck = createDeck();
        game.discardPile = [];
        game.turnIndex = 0;
        game.direction = 1;
        game.started = false;
        game.status = 'waiting';
        game.onePending = null;
        game.winner = null;

        // Reset player states
        game.players.forEach(player => {
          player.hand = [];
          player.ready = false;
        });

        // Notify all players that game was reset
        io.to(gameId).emit('gameReset', { message: 'Starting new game' });
        emitPlayerList(io, game);
        broadcastLobbyList(io);

        console.log(`Game ${gameId} reset for new round`);
      });
    });

    // =====================
    // DISCONNECT HANDLER
    // =====================

    socket.on('disconnect', () => {
      console.log('user disconnected', socket.id);

      for (const [gameId, game] of Object.entries(games)) {
        const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
        if (playerIndex !== -1) {
          const player = game.players[playerIndex];
          console.log(`Player ${player.name} disconnected, starting 5s grace period`);

          player.disconnectTimeout = setTimeout(() => {
            const stillThere = game.players.findIndex(p => p.name === player.name && p.socketId === socket.id);
            if (stillThere === -1) {
              console.log(`Player ${player.name} already reconnected, skipping removal`);
              return;
            }

            console.log(`Removing disconnected player ${player.name} after timeout`);
            const [removed] = game.players.splice(stillThere, 1);
            emitPlayerList(io, game);

            if (removed && removed.socketId === game.ownerId) {
              if (game.players.length > 0) {
                game.ownerId = game.players[0].socketId;
                game.ownerName = game.players[0].name;
                game.players[0].ready = true;  // New owner is always ready
                io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
                if (game.ownerId) {
                  io.to(game.ownerId).emit('privateSet', { joinCode: game.joinCode || null });
                }
                emitPlayerList(io, game);  // Update player list to show new owner as ready
              } else {
                // No players left, delete the game/room
                console.log(`Room ${gameId} is now empty, deleting...`);
                delete games[gameId];
                broadcastLobbyList(io);
                return;
              }
            }

            if (game.players.length === 0) {
              // Game is now empty after player removal, delete it
              console.log(`Game ${gameId} has no players left, deleting...`);
              delete games[gameId];
              broadcastLobbyList(io);
            } else if (game.started && game.players.length > 0) {
              game.turnIndex = game.turnIndex % game.players.length;
              io.to(gameId).emit('turnChanged', { currentPlayerId: game.players[game.turnIndex].id });
            } else if (!game.started) {
              game.status = 'waiting';
            }

            broadcastLobbyList(io);
          }, 5000);
        }
      }
    });
    
    // Handle emoji reactions
    socket.on('emojiReaction', ({ gameId, playerName, emojiId, emojiIcon, emojiImage }) => {
      console.log(`Emoji reaction from ${playerName} in game ${gameId}: ${emojiId}`);
      
      // Broadcast to all players in the game
      io.to(gameId).emit('emojiReaction', {
        playerName,
        emojiIcon,
        emojiImage
      });
    });
    
    // Handle distraction usage
    socket.on('useDistraction', ({ gameId, playerName, distractionType, distractionIcon, distractionName }) => {
      console.log(`Distraction used by ${playerName} in game ${gameId}: ${distractionType}`);
      
      // Broadcast to all players in the game INCLUDING the sender (do this first so effect shows immediately)
      io.to(gameId).emit('distractionReceived', {
        playerName,
        distractionType,
        distractionIcon,
        distractionName
      });
      
      // Update the user's inventory in the database (async, don't block the effect)
      const db = require('../util/database');
      
      // Get userId from the game's player object
      const game = games[gameId];
      if (!game) {
        console.warn(`No game found with ID ${gameId} when using distraction`);
        return;
      }
      
      const player = game.players.find(p => p.socketId === socket.id);
      const userId = player?.userId;
      
      if (!userId) {
        console.warn(`No userId found for ${playerName} when using distraction - effect shown but inventory not updated`);
        return;
      }
      
      console.log(`Fetching inventory for userId: ${userId}`);
      
      db.get('SELECT distractionsInventory FROM users WHERE id = ?', [userId], (err, userData) => {
        if (err) {
          console.error('Error fetching distractions:', err);
          return;
        }
        
        if (!userData) {
          console.error(`No user data found for userId: ${userId}`);
          return;
        }
        
        let inventory = {};
        try {
          inventory = JSON.parse(userData?.distractionsInventory || '{}');
        } catch (e) {
          console.error('Error parsing distractionsInventory:', e);
          inventory = {};
        }
        
        console.log(`Current inventory for ${playerName}:`, inventory);
        
        // Reduce count
        if (inventory[distractionType] && inventory[distractionType] > 0) {
          inventory[distractionType]--;
          if (inventory[distractionType] <= 0) {
            delete inventory[distractionType];
          }
          
          console.log(`Updating inventory for ${playerName}. New inventory:`, inventory);
          
          // Update database
          db.run('UPDATE users SET distractionsInventory = ? WHERE id = ?', [JSON.stringify(inventory), userId], (updateErr) => {
            if (updateErr) {
              console.error('Error updating distractions inventory:', updateErr);
              return;
            }
            
            console.log(`✓ Successfully updated ${playerName}'s inventory in database`);
            
            // Verify the update by reading it back
            db.get('SELECT distractionsInventory FROM users WHERE id = ?', [userId], (verifyErr, verifyData) => {
              if (!verifyErr && verifyData) {
                console.log(`Verified inventory in DB:`, verifyData.distractionsInventory);
              }
            });
            
            // Send updated inventory back to the user who used it
            socket.emit('distractionInventoryUpdated', {
              inventory: inventory
            });
          });
        } else {
          console.warn(`${playerName} tried to use ${distractionType} but inventory count is ${inventory[distractionType] || 0}`);
        }
      });
    });
  });
}

module.exports = { setupSocketHandlers };
