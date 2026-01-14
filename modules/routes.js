const express = require('express');
const { isAuthenticated, handleLogin } = require('./middleware');
const { games } = require('./game');
const paymentRouter = require('./payment');
const db = require('../util/database');

function setupRoutes(app) {
  // Mount payment routes (must be before other routes to handle POST requests)
  app.use('/', paymentRouter);
  
  app.get('/login', handleLogin);

  app.get('/', isAuthenticated, (req, res) => {
    res.render('index.ejs', { user: req.session.user });
  });

  app.get('/game', isAuthenticated, (req, res) => {
    res.render('game.ejs', { user: req.session.user, gameId: req.query.gameId || 'default' });
  });

  app.get('/lobby', isAuthenticated, (req, res) => {
    res.render('lobby.ejs', { user: req.session.user });
  });

  app.get('/profile', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    if (userId) {
      db.get('SELECT xp, level FROM users WHERE id = ?', [userId], (err, userData) => {
        if (err) {
          console.error('Error fetching user XP data:', err);
          res.render('profile.ejs', { user: req.session.user, xp: 0, level: 1, xpForNextLevel: 100 });
        } else {
          const currentXP = userData?.xp || 0;
          const currentLevel = userData?.level || 1;
          const xpForNextLevel = db.calculateXPForLevel(currentLevel + 1);
          res.render('profile.ejs', { 
            user: req.session.user, 
            xp: currentXP, 
            level: currentLevel, 
            xpForNextLevel 
          });
        }
      });
    } else {
      res.render('profile.ejs', { user: req.session.user, xp: 0, level: 1, xpForNextLevel: 100 });
    }
  });

  app.get('/leaderboard', isAuthenticated, (req, res) => {
    db.all(
      "SELECT displayName, wins, losses, gamesPlayed FROM users WHERE gamesPlayed > 0 ORDER BY wins DESC LIMIT 100",
      [],
      (err, rows) => {
        if (err) {
          console.error("Error fetching leaderboard:", err);
          return res.status(500).send("error loading leaderboard")
        }
        res.render('leaderboard', { leaderboard: rows } );
      }
    );
  });

  app.get('/room/:gameId', isAuthenticated, (req, res) => {
    const param = req.params.gameId;
    let game = games[param];
    // If no game found by id, attempt to resolve the param as a join code (case-insensitive)
    if (!game) {
      const code = String(param || '').toLowerCase();
      game = Object.values(games).find(g => g.joinCode && String(g.joinCode).toLowerCase() === code);
      if (game) {
        // redirect to canonical room id URL so clients and sockets use the real game id
        return res.redirect('/room/' + encodeURIComponent(game.id));
      }
    }
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
}

module.exports = { setupRoutes };
