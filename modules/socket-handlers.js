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
      io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));
      io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
      broadcastLobbyList(io);

      console.log(`${player.name} created lobby ${gameId} (${game.lobbyName})`);
    });

    socket.on('joinGame', ({ gameId = 'default', playerName: clientName = 'Player' } = {}) => {
      const game = games[gameId];
      if (!game) {
        socket.emit('joinFailed', { reason: 'Game not found' });
        return;
      }

      const name = (sessUser && String(sessUser)) || clientName || 'Player';

      let player = game.players.find(p => p.name === name);
      if (!player) {
        player = {
          socketId: socket.id,
          id: socket.id,
          name,
          hand: [],
          ready: false
        };
        game.players.push(player);
      } else {
        player.socketId = socket.id;
        player.id = socket.id;
      }

      socket.join(gameId);
      socket.emit('joined', { playerId: player.id, gameId, lobbyName: game.lobbyName });

      io.to(player.socketId).emit('deal', player.hand);
      io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));
      io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
      io.to(gameId).emit('drawPileCount', { count: game.deck.length });

      if (game.started) {
        const currentPlayerId = game.players[game.turnIndex]?.id;
        if (currentPlayerId) {
          io.to(player.socketId).emit('turnChanged', { currentPlayerId });
        }
      }

      if (game.discardPile && game.discardPile.length > 0) {
        const top = game.discardPile[game.discardPile.length - 1];
        io.to(gameId).emit('cardPlacedOnTable', top);
      }
    });

    socket.on('joinLobby', ({ gameId = 'default', playerName: clientName = 'Anonymous', joinCode = null } = {}) => {
      const game = games[gameId];
      if (!game) {
        socket.emit('lobbyJoinError', { reason: 'Lobby not found' });
        return;
      }
      if (game.private) {
        if (!joinCode || String(joinCode) !== String(game.joinCode || '').toUpperCase()) {
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
        socket.emit('joined', { playerId: existing.id, gameId, lobbyName: game.lobbyName, isPrivate: !!game.private, joinCode: (socket.id === game.ownerId ? game.joinCode : null) });
        io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));
        io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
        broadcastLobbyList(io);
        return;
      }

      const existingByName = game.players.find(p => p.name === playerName);
      if (existingByName) {
        const wasReady = existingByName.ready;
        console.log(`Player ${playerName} rejoining: wasReady=${wasReady}, isOwner=${game.ownerName === playerName}`);

        if (existingByName.disconnectTimeout) {
          clearTimeout(existingByName.disconnectTimeout);
          existingByName.disconnectTimeout = null;
          console.log(`Cleared disconnect timeout for ${playerName}`);
        }

        existingByName.socketId = socket.id;
        existingByName.id = socket.id;
        existingByName.ready = wasReady;

        socket.join(gameId);
        socket.emit('joined', { playerId: existingByName.id, gameId, lobbyName: game.lobbyName, isPrivate: !!game.private, joinCode: (socket.id === game.ownerId ? game.joinCode : null) });

        if (game.ownerName && game.ownerName === playerName) {
          game.ownerId = socket.id;
          existingByName.ready = true;
          console.log(`Owner ${playerName} reconnected, setting ready=true`);
          io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
        }

        console.log(`After rejoin - Players:`, game.players.map(p => ({ name: p.name, ready: p.ready })));
        io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));
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
      io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));
      io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
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
      if (game.private) {
        game.joinCode = generateJoinCode(6);
      } else {
        game.joinCode = null;
      }
      io.to(gameId).emit('privateChanged', { isPrivate: !!game.private });
      io.to(game.ownerId).emit('privateSet', { joinCode: game.joinCode || null });
      broadcastLobbyList(io);
    });

    socket.on('leaveLobby', ({ gameId } = {}) => {
      const game = games[gameId];
      if (!game) return;
      const real = game.players.findIndex(p => p.socketId === socket.id);
      if (real === -1) return;
      const [removed] = game.players.splice(real, 1);
      socket.leave(gameId);
      io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));

      if (removed && removed.socketId === game.ownerId) {
        if (game.players.length > 0) {
          game.ownerId = game.players[0].socketId;
          game.ownerName = game.players[0].name;
          io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
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
      io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));
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
      io.to(gameId).emit('gameStarted', { currentPlayerId, players: game.players.map(p => ({ id: p.id, name: p.name })) });

      if (game.discardPile.length > 0) {
        const top = game.discardPile[game.discardPile.length - 1];

        io.to(gameId).emit('cardPlacedOnTable', top);

        if (top.color === 'wild') {
          const currentSocketId = game.players[game.turnIndex].socketId;
          io.to(currentSocketId).emit('requestStartColor', { gameId, card: top });
          io.to(gameId).emit('cardPlacedOnTable', top);
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
      player.hand.push(...drawn);

      io.to(player.socketId).emit('deal', player.hand);
      io.to(gameId).emit('playerDrew', { playerId: player.id, count: drawn.length });
      io.to(gameId).emit('drawPileCount', { count: game.deck.length });

      const playerCount = game.players.length;
      const step = game.direction;
      const nextIndex = ((game.turnIndex + step) % playerCount + playerCount) % playerCount;
      game.turnIndex = nextIndex;

      const nextPlayerId = game.players[game.turnIndex].id;
      io.to(gameId).emit('turnChanged', { currentPlayerId: nextPlayerId });
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

      const [card] = player.hand.splice(cardIndex, 1);
      const topCard = game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : null;
      const topActiveColor = topCard ? (topCard.activeColor || topCard.color) : null;

      const isWild = card.color === 'wild';
      const matchesColor = topActiveColor && card.color === topActiveColor;
      const matchesValue = topCard && String(card.value) === String(topCard.value);
      const isValidPlay = !topCard || isWild || matchesColor || matchesValue;
      if (!isValidPlay) {
        player.hand.push(card);
        socket.emit('invalidMove', { reason: 'Card doesnt match color or value twin' });
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

      // ONE timer logic
      try {
        if (game.onePending && game.onePending.playerId !== player.id) {
          // keep pending for other player
        }
        if (player.hand.length === 1) {
          if (game.onePending && game.onePending.playerId === player.id) {
            clearOnePending(game);
          }
          const penaltyDelayMs = 5000;
          const timeoutId = setTimeout(() => {
            if (!game.onePending || game.onePending.playerId !== player.id) return;
            const drawn = drawFromDeck(game, 2);
            player.hand.push(...drawn);
            io.to(player.socketId).emit('deal', player.hand);
            io.to(gameId).emit('playerPenalized', { playerId: player.id, playerName: player.name, count: drawn.length });
            io.to(gameId).emit('playerDrew', { playerId: player.id, count: drawn.length });
            io.to(gameId).emit('drawPileCount', { count: game.deck.length });
            clearOnePending(game);
          }, penaltyDelayMs);

          game.onePending = {
            playerId: player.id,
            timeoutId,
            expiresAt: Date.now() + penaltyDelayMs
          };

          io.to(player.socketId).emit('youHaveOne', { expiresAt: game.onePending.expiresAt });
        } else {
          if (game.onePending && game.onePending.playerId === player.id) {
            clearOnePending(game);
          }
        }
      } catch (e) {
        console.error('error starting ONE timer', e);
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
            io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));

            if (removed && removed.socketId === game.ownerId) {
              if (game.players.length > 0) {
                game.ownerId = game.players[0].socketId;
                game.ownerName = game.players[0].name;
                io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
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
