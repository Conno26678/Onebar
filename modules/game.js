const { createDeck, shuffle } = require('../cards');

// storage for all active games
const games = {};

/**
 * Generate a random join code for private lobbies
 * @param {number} length - Length of the code (default 6)
 * @returns {string} Uppercase alphanumeric code
 */
function generateJoinCode(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing chars like 0, O, 1, I
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Initialize a new game with default state
 * @param {string} gameId  
 * @returns {object} 
 */
function initGame(gameId) {
  const game = {
    id: gameId,
    deck: createDeck(),
    discardPile: [],
    players: [],
    turnIndex: 0,
    direction: 1, // 1 = clockwise, -1 = counter-clockwise
    started: false,
    ownerId: null,
    ownerName: null,
    lobbyName: null,
    maxPlayers: 8,
    createdAt: Date.now(),
    status: 'waiting',
    private: false,
    joinCode: null,
    onePending: null,
    winner: null,
    rules: {
      stacking: false,
      jumpIn: false,
      sevenZero: false
    },
    drawStack: 0,  // Accumulated draw cards for stacking rule
    turnTimer: null,  // Timer for current turn
    turnTimeRemaining: 15,  // Time remaining in seconds (15-30)
    turnCountdown: null  // Interval for countdown updates
  };
  games[gameId] = game;
  return game;
}

/**
 * Clear the "ONE" penalty timer for a player
 * @param {object} game
 */
function clearOnePending(game) {
  if (game.onePending && game.onePending.timeoutId) {
    clearTimeout(game.onePending.timeoutId);
  }
  game.onePending = null;
}

/**
 * Clear the turn timer for the game
 * @param {object} game
 */
function clearTurnTimer(game) {
  if (game.turnTimer) {
    clearTimeout(game.turnTimer);
    game.turnTimer = null;
  }
  if (game.turnCountdown) {
    clearInterval(game.turnCountdown);
    game.turnCountdown = null;
  }
}

/**
 * Draw cards from the deck, reshuffling discard pile if needed
 * @param {object} game 
 * @param {number} count 
 * @returns {Array} 
 */
function drawFromDeck(game, count = 1) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    // If deck is empty, reshuffle discard pile (except top card)
    if (game.deck.length === 0) {
      if (game.discardPile.length <= 1) {
        // No cards to reshuffle
        break;
      }
      const topCard = game.discardPile.pop();
      // Reset activeColor on reshuffled cards
      game.discardPile.forEach(c => {
        delete c.activeColor;
      });
      game.deck = shuffle([...game.discardPile]);
      game.discardPile = [topCard];
    }
    if (game.deck.length > 0) {
      drawn.push(game.deck.pop());
    }
  }
  return drawn;
}

/**
 * Get list of public lobbies for the lobby browser
 * @returns {Array}
 */
function getLobbyList() {
  return Object.values(games)
    .filter(g => !g.private && !g.started && g.status === 'waiting')
    .map(g => ({
      gameId: g.id,
      lobbyName: g.lobbyName || `Game ${g.id.slice(0, 6)}`,
      ownerName: g.ownerName || 'Unknown',
      playerCount: g.players.length,
      maxPlayers: g.maxPlayers || 8,
      status: g.status || 'waiting'
    }));
}

function endGame(roomCode, winnerId) {
  db.run("UPDATE users SET wins = wins +1, gamesPlayed +1 WHERE id = ?",
    [winnerId],
    (err) => {
      if (err) console.error("Error updating user stats:", err);
    }
  );
}

module.exports = {
  games,
  generateJoinCode,
  initGame,
  clearOnePending,
  clearTurnTimer,
  drawFromDeck,
  getLobbyList,
  shuffle
};
