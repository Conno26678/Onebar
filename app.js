//Imports
const express = require('express');
const app = express();
const path = require('path');
const ejs = require('ejs');
const socketIO = require('socket.io');
const http = require('http');
const server = http.createServer(app);
const io = socketIO(server);
require('dotenv').config();
const port = process.env.PORT || 3000;
const AUTH_URL = process.env.AUTH_URL || 'https://formbeta.yorktechapps.com/';
const THIS_URL = process.env.THIS_URL || `http://localhost:${port}`;
const jwt = require('jsonwebtoken');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');

//modules
const { createDeck, shuffle } = require('./cards');

//Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
const sessionMiddleware = session({
  secret: 'Ich bin dein Gummibär, ich bin dein Gummibär',
  resave: false,
  saveUninitialized: false
});
app.use(sessionMiddleware);

// Attach session middleware to socket.io so we can read session in sockets
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

function isAuthenticated(req, res, next) {
  if (req.session.user) {
    const tokenData = req.session.token;

    try {
      // Check if the token has expired
      const currentTime = Math.floor(Date.now() / 1000);
      if (tokenData.exp < currentTime) {
        throw new Error('Token has expired');
      }
      next();
    } catch (err) {
      console.log('Authentication error:', err.message);
      req.session.destroy();
      res.redirect('/login');
    }
  } else {
    console.log('User not authenticated, redirecting to login');
    res.redirect('/login');
  }
}

app.get('/login', (req, res) => {
  if (req.query.token) {
    const rawToken = req.query.token;
    const tokenData = jwt.decode(rawToken);

    req.session.token = tokenData;
    req.session.user = tokenData.displayName;
    req.session.permission = tokenData.permissions;

    const redirectTo = req.query.redirectURL || '/';
    res.redirect(redirectTo);
    console.log(`User ${tokenData.displayName} logged in`);
  } else {
    res.redirect(`${AUTH_URL}/oauth?redirectURL=${THIS_URL}/login`);
    console.log('Redirecting to auth server');
  }
});

//Routes
app.get('/', isAuthenticated, (req, res) => {
  res.render('index.ejs', { user: req.session.user });
});

app.get('/game', isAuthenticated, (req, res) => {
  res.render('game.ejs', { user: req.session.user, gameId: req.query.gameId || 'default' });
});

app.get('/lobby', isAuthenticated, (req, res) => {
  res.render('lobby.ejs', { user: req.session.user });
});

app.get('/room/:gameId', isAuthenticated, (req, res) => {
  const game = games[req.params.gameId];
  const lobbyName = (game && game.lobbyName) ? game.lobbyName : (req.query.lobbyName || '');
  res.render('room.ejs', { user: req.session.user, gameId: req.params.gameId, lobbyName });
});

app.get('/about', (req, res) => {
  res.render('about.ejs', { user: req.session.user });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

const games = {};// { [gameId]: { players: [{ socketId, id, name, hand: [], disconnectTimeout: null }], deck: [], turnIndex: 0 } }

function generateJoinCode(len = 6) {
  const chars = "ABCDEFGHIJKLMNOPQWRTUVWXYZ23456789";
  let out= "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function initGame(gameId = 'default') {
  const deck = createDeck();
  shuffle(deck);
  games[gameId] = {
    players: [],
    deck,
    discardPile: [],
    turnIndex: 0,
    direction: 1, // 1 for clockwise, -1 for counter-clockwise
    started: false,
    onePending: null,

    //lobby data
    ownerId: null,
    ownerName: null,
    lobbyName: null,
    maxPlayers: 8,
    createdAt: Date.now(),
    status: 'waiting',

    //privacy
    private: false,
    joinCode: null
  };
  return games[gameId];
}

// Broadcasting lobby lists
function broadcastLobbyList() {
  const list = Object.entries(games)
  .filter(([, g]) => g && Array.isArray(g.players) && g.players.length > 0 && !g.private)// g = game, check that it exists
  .map(([id, g]) => ({
    gameId: id,
    lobbyName: g.lobbyName || `Lobby ${id.slice(0, 6)}`,
    ownerName: g.ownerName || 'Host',
    playerCount: g.players.length,
    maxplayers: g.maxplayers || 8,
    status: g.started ? 'started' : (g.status || 'waiting'),
    createdAt: g.createdAt || 0
  }));
  io.emit('lobbyList', list);
}

//ONE timer
function clearOnePending(game) {
  if (!game || !game.onePending) return;
  try {
    clearTimeout(game.onePending.timeoutId);
  } catch (e) { }
  game.onePending = null;
}

// Draw cards from the deck, refilling from discard pile if needed
function drawFromDeck(game, count = 1) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (game.deck.length === 0) {
      // Refill deck from discard pile, but keep the top card on the table
      if (game.discardPile.length > 1) {
        const top = game.discardPile.pop(); // removes the top, shuffles the rest, puts the top back
        const rest = game.discardPile.splice(0);
        game.deck = shuffle(rest);
        game.discardPile = [top];
      } else {
        // No cards to draw
        break;
      }
    }
    if (game.deck.length === 0) break;
    drawn.push(game.deck.pop());
  }
  return drawn;
}

io.on('connection', (socket) => {
  const sess = socket.request && socket.request.session;
  const sessUser = sess && sess.user ? String(sess.user) : 'null';

  console.log('a user connected:', socket.id);

  //Client current lobby list
  socket.emit('lobbyList', Object.entries(games).map(([id, g]) => ({
    gameId: id,
    lobbyName: g.lobbyName || `Lobby ${id.slice(0, 6)}`,
    ownerName: g.ownerName || 'Host',
    playerCount: g.players.length,
    maxplayers: g.maxplayers || 8,
    status: g.started ? 'started' : (g.status || 'waiting'),
  })));

  //New lobby/auto join
  socket.on('createLobby', ({ lobbyName = null, maxPlayers = 8, playerName: clientName = 'Host', isPrivate = false} = {}) => {
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
      game.joinCode = generateJoinCode();
    }

    //Creator auto-joins
    const player = {
      socketId: socket.id,
      id: socket.id,
      name: playerName || 'Host',
      hand: [],
      ready: false
    };
    game.players.push(player);
    socket.join(gameId);

    //Notify creator
    socket.emit('lobbyCreated', { gameId, lobbyName: game.lobbyName, isPrivate: game.private, joinCode: game.joinCode });
    //notify all clients of updated lobby list
    io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));
    // inform room about the current owner
    io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
    broadcastLobbyList();

    console.log(`${player.name} created lobby ${gameId} (${game.lobbyName})`);
  });

  // Re-associate a newly-connected socket with an existing game
  socket.on('joinGame', ({ gameId = 'default', playerName: clientName = 'Player' } = {}) => {
    const game = games[gameId];
    if (!game) {
      socket.emit('joinFailed', { reason: 'Game not found' });
      return;
    }

    const name = (sessUser && String(sessUser)) || clientName || 'Player';

    // Try to find an existing player by name; if found, update their socketId to this new socket.
    let player = game.players.find(p => p.name === name);
    if (!player) {
      // If not found, add them as a new player.
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

    // Send the player's current hand directly to them
    io.to(player.socketId).emit('deal', player.hand);

    // Broadcast the up-to-date player list and owner info to the room
    io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));
    io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
    io.to(gameId).emit('drawPileCount', { count: game.deck.length });

    // If the game has started, send the current turn and top discard card
    if (game.started) {
      const currentPlayerId = game.players[game.turnIndex]?.id;
      if (currentPlayerId) {
        io.to(player.socketId).emit('turnChanged', { currentPlayerId });
      }
    }

    // If there is a top discard card, send it so the game UI can show it
    if (game.discardPile && game.discardPile.length > 0) {
      const top = game.discardPile[game.discardPile.length - 1];
      io.to(gameId).emit('cardPlacedOnTable', top);
    }
  });

  //Join an existing lobby
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
    
    //name
    const playerName = (sessUser && String(sessUser)) || clientName || 'Player';

    //add player
    const existing = game.players.find(p => p.socketId === socket.id);
    if (existing) {
      socket.join(gameId);
      socket.emit('joined', { playerId: existing.id, gameId, lobbyName: game.lobbyName, isPrivate: !!game.private, joinCode: (socket.id === game.ownerId ? game.joinCode : null) });
      io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));
      io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
      broadcastLobbyList();
      return;
    }

    const existingByName = game.players.find(p => p.name === playerName);
    if (existingByName) {
      const wasReady = existingByName.ready;
      console.log(`Player ${playerName} rejoining: wasReady=${wasReady}, isOwner=${game.ownerName === playerName}`);
      
      // Clear any pending disconnect timeout for this player
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

      // If this player is the lobby owner by name, reassign ownerId to the new socket.id and ensure ready to true
      if (game.ownerName && game.ownerName === playerName) {
        game.ownerId = socket.id;
        existingByName.ready = true;
        console.log(`Owner ${playerName} reconnected, setting ready=true`);
        io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
      }

      console.log(`After rejoin - Players:`, game.players.map(p => ({ name: p.name, ready: p.ready })));
      io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));
      broadcastLobbyList();
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
    broadcastLobbyList();

    console.log(`${player.name} joined lobby ${gameId} (${game.lobbyName})`);
  });

  // Set lobby privacy
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
    // tell the room about privacy change
    io.to(gameId).emit('privateChanged', { isPrivate: !!game.private });
    // also send join code only to owner socket
    io.to(game.ownerId).emit('privateSet', { joinCode: game.joinCode || null });
    broadcastLobbyList();
  });
  //Leaving lobby
  socket.on('leaveLobby', ({ gameId } = {}) => {
    const game = games[gameId];
    if (!game) return;
    const real = game.players.findIndex(p => p.socketId === socket.id);
    if (real === -1) return;
    const [removed] = game.players.splice(real, 1);
    socket.leave(gameId);
    io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));

    //if owner leaves, promote new owner
    if (removed && removed.socketId === game.ownerId) {
      if (game.players.length > 0) {
        game.ownerId = game.players[0].socketId;
        game.ownerName = game.players[0].name;
        io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
      } else {
        // kill lobby if no one exists
        delete games[gameId];
      }
    }
    broadcastLobbyList();
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
    broadcastLobbyList();
  });

  socket.on('startGame', ({ gameId = 'default', handSize = 7 } = {}) => {
    const game = games[gameId] || initGame(gameId);
    if (!game) return;
    
    console.log('=== START GAME REQUEST ===');
    console.log('Game ID:', gameId);
    console.log('Owner ID:', game.ownerId);
    console.log('Socket ID:', socket.id);
    console.log('Players:', game.players.map(p => ({ name: p.name, id: p.id, ready: p.ready })));
    
    // Only owner can start
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
    // validate hand size
    handSize = Number(handSize) || 7;
    if (handSize < 1) handSize = 1;

    // enforce maxPlayers (defensive)
    if (game.players.length > (game.maxPlayers || 32)) {
      socket.emit('invalidMove', { reason: 'Too many players to start' });
      return;
    }

    // ensure deck is shuffled
    shuffle(game.deck);
    // deal
    for (const player of game.players) {
      player.hand = game.deck.splice(0, handSize);
      io.to(player.socketId).emit('deal', player.hand);
    }
    // Start discard pile with top card
    if (game.deck.length > 0) {
      const top = game.deck.pop();
      game.discardPile = [top];
    } else {
      game.discardPile = [];
    }

    //remaining draw pile count
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
    //draw
    const drawn = drawFromDeck(game, 1);
    if (!drawn || drawn.length === 0) {
      socket.emit('invalidMove', { reason: 'No cards left to draw' });
      return;
    }

    const player = game.players[playerIndex];
    player.hand.push(...drawn);

    //send updated hand
    io.to(player.socketId).emit('deal', player.hand);

    //notify others
    io.to(gameId).emit('playerDrew', { playerId: player.id, count: drawn.length });

    //remaining draw pile count
    io.to(gameId).emit('drawPileCount', { count: game.deck.length });

    //advance turn
    const playerCount = game.players.length;
    const step = game.direction;
    const nextIndex = ((game.turnIndex + step) % playerCount + playerCount) % playerCount;
    game.turnIndex = nextIndex;

    const nextPlayerId = game.players[game.turnIndex].id;
    io.to(gameId).emit('turnChanged', { currentPlayerId: nextPlayerId });
  });

  // Receive the chosen start color from the player who was asked
  socket.on('startColorChosen', ({ gameId = 'default', color } = {}) => {
    const game = games[gameId];
    if (!game) return;
    // ensure there's a top card and it's a wild without activeColor
    if (!game.discardPile || game.discardPile.length === 0) return;
    const top = game.discardPile[game.discardPile.length - 1];
    if (top.color !== 'wild' || top.activeColor) return;

    // only the current player should be allowed to choose the start color
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

    // Broadcast updated top card and keep the turn with the chooser
    io.to(gameId).emit('cardPlacedOnTable', top);
    io.to(gameId).emit('turnChanged', { currentPlayerId: currentPlayer.id });

    console.log(`Start color chosen for game ${gameId}: ${color}`);
  });

  //Handles playing a card
  socket.on('playCard', ({ gameId = 'default', cardId, chosenColor } = {}) => {
    const game = games[gameId];
    if (!game || !game.started) {
      socket.emit('invalidMove', { reason: 'Game not started' });
      return;
    }
    //Handles turn order and card validation
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
    //Handles putting a card down
    const [card] = player.hand.splice(cardIndex, 1);
    const topCard = game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : null;
    const topActiveColor = topCard ? (topCard.activeColor || topCard.color) : null;

    // Make wilds playable anytime; otherwise gets matched by color/value
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

    //discards and then plays
    game.discardPile.push(card);
    io.to(gameId).emit('cardPlayed', { playerId: player.id, playerName: player.name, card });

    //determines direction
    const playerCount = game.players.length;
    const step = game.direction;
    let nextIndex = ((playerIndex + step) % playerCount + playerCount) % playerCount;


    // Handle special cards
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

      // reverse
    } else if (special === 'reverse') {
      game.direction = -game.direction;
      if (playerCount === 2) {
        nextIndex = playerIndex; // in 2-player game, reverse acts like skip
      } else {
        //one step in new direction after reverse
        nextIndex = ((playerIndex + game.direction) % playerCount + playerCount) % playerCount;
      }
    }

    // Handles advancing turn
    game.turnIndex = nextIndex;

    const nextPlayerId = game.players[game.turnIndex].id;
    io.to(gameId).emit('turnChanged', { currentPlayerId: nextPlayerId });

    // after any draw-from-deck call inside playCard, add:
    io.to(gameId).emit('drawPileCount', { count: game.deck.length });

    // If the player now has exactly 1 card, start a ONE timer
    try {
      // Clear any previous pending ONE
      if (game.onePending && game.onePending.playerId !== player.id) {
        // keep pending for other player until it expires or is cleared
      }
      // If this player has 1 card, start a timer that penalizes them if they don't call ONE
      if (player.hand.length === 1) {
        if (game.onePending && game.onePending.playerId === player.id) {
          clearOnePending(game);
        }
        const penaltyDelayMs = 5000;
        const timeoutId = setTimeout(() => {
          // ensure pending still refers to the same player
          if (!game.onePending || game.onePending.playerId !== player.id) return;
          // +2 penalty
          const drawn = drawFromDeck(game, 2);
          player.hand.push(...drawn);
          io.to(player.socketId).emit('deal', player.hand);
          io.to(gameId).emit('playerPenalized', { playerId: player.id, playerName: player.name, count: drawn.length });
          io.to(gameId).emit('playerDrew', { playerId: player.id, count: drawn.length });
          // update draw pile count
          io.to(gameId).emit('drawPileCount', { count: game.deck.length });
          // clear pending 
          clearOnePending(game);
        }, penaltyDelayMs);

        game.onePending = {
          playerId: player.id,
          timeoutId,
          expiresAt: Date.now() + penaltyDelayMs
        };

        // Notify that the server expects them to call ONE
        io.to(player.socketId).emit('youHaveOne', { expiresAt: game.onePending.expiresAt });
      } else {
        // If the player does not have one, clear that player
        if (game.onePending && game.onePending.playerId === player.id) {
          clearOnePending(game);
        }
      }
    } catch (e) {
      console.error('error starting ONE timer', e);
    }

    //Win detection
    if (player.hand.length === 0) {
      if (game.onePending && game.onePending.playerId === player.id) clearOnePending(game);

      game.started = false;
      game.winner = { id: player.id, name: player.name, timestamp: Date.now() };

      //inform who won
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

  // Player calls ONE
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
    //must actually have one card
    if (!player || player.hand.length !== 1) {
      socket.emit('invalidOneCall', { reason: 'You do not have exactly one card' });
      return;
    }

    // If there's a pending timer for this player, clear it
    if (game.onePending && game.onePending.playerId === player.id) {
      clearOnePending(game);
    }

    // Broadcast to everyone that this player called ONE
    io.to(gameId).emit('playerCalledOne', { playerId: player.id, playerName: player.name });
  });

  socket.on('disconnect', () => {
    console.log('user disconnected', socket.id);
    
    // Give players a short grace period to reconnect before removing them
    for (const [gameId, game] of Object.entries(games)) {
      const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        const player = game.players[playerIndex];
        console.log(`Player ${player.name} disconnected, starting 5s grace period`);
        
        // Store the timeout on the player object so we can cancel it if they reconnect
        player.disconnectTimeout = setTimeout(() => {
          // Double-check the player is still there and still has this socket ID
          const stillThere = game.players.findIndex(p => p.name === player.name && p.socketId === socket.id);
          if (stillThere === -1) {
            console.log(`Player ${player.name} already reconnected, skipping removal`);
            return;
          }
          
          console.log(`Removing disconnected player ${player.name} after timeout`);
          const [removed] = game.players.splice(stillThere, 1);
          io.to(gameId).emit('playerList', game.players.map(p => ({ id: p.id, name: p.name, ready: !!p.ready })));
          
          // if owner left
          if (removed && removed.socketId === game.ownerId) {
            if (game.players.length > 0) {
              game.ownerId = game.players[0].socketId;
              game.ownerName = game.players[0].name;
              io.to(gameId).emit('ownerChanged', { ownerId: game.ownerId, ownerName: game.ownerName });
            } else {
              // delete lobby entirely
              delete games[gameId];
              return;
            }
          }
          
          // if it was their turn, adjust turnIndex 
          if (game.started && game.players.length > 0) {
            game.turnIndex = game.turnIndex % game.players.length;
            io.to(gameId).emit('turnChanged', { currentPlayerId: game.players[game.turnIndex].id });
          } else if (!game.started) {
            game.status = 'waiting';
          }

          broadcastLobbyList();
        }, 5000); // 5 second grace period for page navigation
      }
    }
  });
});

//Start the server silly
server.listen(port, () => {
  console.log(`app listening at http://localhost:${port}`);
});