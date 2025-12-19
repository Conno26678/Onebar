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

function broadcastLobbyList(io) {
  io.emit('lobbyList', getLobbyList());
}

// When emitting playerList, include card counts and ready status:
function emitPlayerList(io, game) {
  const playerData = game.players.map(p => ({
    id: p.id,
    name: p.name,
    cardCount: p.hand ? p.hand.length : 0,
    ready: !!p.ready
  }));
  io.to(game.id).emit('playerList', playerData);
}

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    const sess = socket.request && socket.request.session;
    const sessUser = sess && sess.user ? String(sess.user) : 'null';

    console.log('a user connected:', socket.id);

    // Client current lobby list
    socket.emit('lobbyList', getLobbyList());

    // =====================
    // LOBBY HANDLERS
    // =====================

    socket.on('createLobby', ({ lobbyName = null, maxPlayers = 8, playerName: clientName = 'Host', isPrivate = false } = {}) => {
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

      // Creator auto-joins
      const player = {
        socketId: socket.id,
        id: socket.id,
        name: playerName || 'Host',
        hand: [],
        ready: false
      };
      game.players.push(player);
      socket.join(gameId);

      // Notify creator
      socket.emit('lobbyCreated', { gameId, lobbyName: game.lobbyName, isPrivate: game.private, joinCode: game.joinCode });
      emitPlayerList(io, game);
      io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
      // Broadcast join code to all players in the room
      io.to(gameId).emit('privateSet', { joinCode: game.joinCode || null });
      broadcastLobbyList(io);

      console.log(`${player.name} created lobby ${gameId} (${game.lobbyName})`);
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
      
      if (!player) {
        // New player joining mid-game - only allow if game hasn't started
        if (game.started) {
          socket.emit('joinFailed', { reason: 'Game already in progress' });
          return;
        }
        player = {
          socketId: socket.id,
          id: socket.id,
          name,
          hand: [],
          ready: false
        };
        game.players.push(player);
        console.log(`New player ${name} joined game ${gameId}`);
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
        console.log(`Player ${name} reconnected to game ${gameId}`);
      }

      socket.join(gameId);
      socket.emit('joined', { playerId: player.id, gameId, lobbyName: game.lobbyName });

      // Send the player's current hand
      io.to(player.socketId).emit('deal', player.hand);
      emitPlayerList(io, game);
      io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
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
        if (top.color === 'wild' && !top.activeColor && game.started) {
          const currentPlayer = game.players[game.turnIndex];
          if (currentPlayer && currentPlayer.socketId === socket.id) {
            io.to(socket.id).emit('requestStartColor', { gameId, card: top });
            console.log('Re-requesting starting color after join for', player.name);
          }
        }
      }
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
        socket.emit('joined', { playerId: existing.id, gameId, lobbyName: game.lobbyName, isPrivate: !!game.private, joinCode: game.joinCode || null });
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
        existingByName.ready = wasReady;

        // Update owner socket id BEFORE sending events
        if (isOwner) {
          game.ownerId = socket.id;
          existingByName.ready = true;
          console.log(`Owner ${playerName} reconnected, setting ready=true`);
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
          ownerName: game.ownerName
        });

        io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
        io.to(gameId).emit('privateSet', { joinCode: game.joinCode || null });

        console.log(`After rejoin - Players:`, game.players.map(p => ({ name: p.name, ready: p.ready })));
        emitPlayerList(io, game);
        broadcastLobbyList(io);
        console.log(`${playerName} rejoined lobby ${gameId} (${game.lobbyName})`);
        return;
      }

      const player = {
        socketId: socket.id,
        id: socket.id,
        name: playerName || 'Player',
        hand: [],
        ready: false
      };
      game.players.push(player);
      socket.join(gameId);
      socket.emit('joined', { playerId: player.id, gameId, lobbyName: game.lobbyName, isPrivate: !!game.private, joinCode: (socket.id === game.ownerId ? game.joinCode : null) });
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
          io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
          if (game.ownerId) {
            io.to(game.ownerId).emit('privateSet', { joinCode: game.joinCode || null });
          }
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
      console.log(`Player ${game.players[real].name} setting ready to ${ready}`);
      game.players[real].ready = !!ready;
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

      const currentPlayerId = game.players[game.turnIndex].id;
      const currentSocketId = game.players[game.turnIndex].socketId;
      io.to(gameId).emit('gameStarted', { currentPlayerId, players: game.players.map(p => ({ id: p.id, name: p.name })) });

      if (game.discardPile.length > 0) {
        const top = game.discardPile[game.discardPile.length - 1];

        io.to(gameId).emit('cardPlacedOnTable', top);

        if (top.color === 'wild') {
          io.to(currentSocketId).emit('requestStartColor', { gameId, card: top });
          console.log('requesting starting color', currentSocketId);
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
      const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex === -1) {
        socket.emit('invalidMove', { reason: 'Not in game' });
        return;
      }
      if (playerIndex !== game.turnIndex) {
        socket.emit('invalidMove', { reason: 'Not your turn' });
        return;
      }

      const drawn = drawFromDeck(game, 1);
      if (!drawn || drawn.length === 0) {
        socket.emit('invalidMove', { reason: 'No cards left to draw' });
        return;
      }

      const player = game.players[playerIndex];
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

      io.to(gameId).emit('cardPlacedOnTable', top);
      io.to(gameId).emit('turnChanged', { currentPlayerId: currentPlayer.id });

      console.log(`Start color chosen for game ${gameId}: ${color}`);
    });

    socket.on('playCard', ({ gameId = 'default', cardId, chosenColor } = {}) => {
      const game = games[gameId];
      if (!game || !game.started) {
        socket.emit('invalidMove', { reason: 'Game not started' });
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

      // SKIP
      if (special === 'skip' || special === 'skip_2') {
        nextIndex = ((nextIndex + step) % playerCount + playerCount) % playerCount;

        // WILD DRAW FOUR
      } else if (
        special === 'wild draw four' ||
        special === 'wild_draw_four' ||
        special.includes('draw four') ||
        special.includes('draw_four') ||
        special.includes('wild draw')
      ) {
        const victim = game.players[nextIndex];
        const drawn = drawFromDeck(game, 4);
        victim.hand.push(...drawn);
        io.to(victim.socketId).emit('deal', victim.hand);
        io.to(gameId).emit('playerDrew', { playerId: victim.id, count: drawn.length });
        nextIndex = ((nextIndex + step) % playerCount + playerCount) % playerCount;

        // DRAW TWO
      } else if (
        special === 'draw two' ||
        special === 'draw_two' ||
        special.includes('draw two') ||
        special.includes('draw_two')
      ) {
        const victim = game.players[nextIndex];
        const drawn = drawFromDeck(game, 2);
        victim.hand.push(...drawn);
        io.to(victim.socketId).emit('deal', victim.hand);
        io.to(gameId).emit('playerDrewCards', { playerId: victim.id, count: drawn.length });
        nextIndex = ((nextIndex + step) % playerCount + playerCount) % playerCount;

        // REVERSE
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

        io.to(gameId).emit('playerWon', { playerId: player.id, playerName: player.name });
        io.to(gameId).emit('gameEnded', {
          winner: { id: player.id, name: player.name },
          players: game.players.map(p => ({ id: p.id, name: p.name, handCount: p.hand.length })),
          discardTop: game.discardPile[game.discardPile.length - 1] || null
        });

        console.log(`Player ${player.name} (${player.id}) won game ${gameId}`);
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

      io.to(gameId).emit('playerCalledOne', { playerId: player.id, playerName: player.name });
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
                io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
                if (game.ownerId) {
                  io.to(game.ownerId).emit('privateSet', { joinCode: game.joinCode || null });
                }
              } else {
                delete games[gameId];
                return;
              }
            }

            if (game.started && game.players.length > 0) {
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
  });
}

module.exports = { setupSocketHandlers };
