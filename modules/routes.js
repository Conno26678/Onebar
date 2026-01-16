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

  app.get('/battlepass', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    if (userId) {
      db.get('SELECT xp, level, hasBattlePassPremium FROM users WHERE id = ?', [userId], (err, userData) => {
        if (err) {
          console.error('Error fetching user XP data:', err);
          res.render('battlepass.ejs', { user: req.session.user, xp: 0, level: 1, xpForNextLevel: 100, hasBattlePassPremium: 0 });
        } else {
          const currentXP = userData?.xp || 0;
          const currentLevel = userData?.level || 1;
          const hasBattlePassPremium = userData?.hasBattlePassPremium || 0;
          const xpForNextLevel = db.calculateXPForLevel(currentLevel + 1);
          res.render('battlepass.ejs', { 
            user: { ...req.session.user, hasPaid: hasBattlePassPremium },
            xp: currentXP, 
            level: currentLevel, 
            xpForNextLevel,
            hasBattlePassPremium
          });
        }
      });
    } else {
      res.render('battlepass.ejs', { user: req.session.user, xp: 0, level: 1, xpForNextLevel: 100, hasBattlePassPremium: 0 });
    }
  });

  app.get('/profile', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const displayName = req.session.user;
    
    if (userId) {
      // First, check who is in 1st place
      db.get(
        "SELECT id, displayName FROM users WHERE gamesPlayed > 0 ORDER BY wins DESC LIMIT 1",
        [],
        (leaderErr, firstPlaceUser) => {
          // Determine if this user should have king.png
          const shouldHaveKing = !leaderErr && firstPlaceUser && firstPlaceUser.id === userId;
          const kingPicture = '/img/king.png';
          const defaultPicture = '/img/pfp.png';
          
          if (leaderErr) {
            console.error('Error checking leaderboard:', leaderErr);
          }
          
          // Get current user data
          db.get('SELECT xp, level, profilePicture FROM users WHERE id = ?', [userId], (err, userData) => {
            if (err) {
              console.error('Error fetching user data:', err);
              res.render('profile.ejs', { 
                user: req.session.user, 
                xp: 0, 
                level: 1, 
                xpForNextLevel: 100,
                profilePicture: defaultPicture,
                isFirstPlace: false
              });
            } else {
              const currentXP = userData?.xp || 0;
              const currentLevel = userData?.level || 1;
              const xpForNextLevel = db.calculateXPForLevel(currentLevel + 1);
              const currentPfp = userData?.profilePicture || defaultPicture;
              
              // Auto-update profile picture based on leaderboard position
              const newPfp = shouldHaveKing ? kingPicture : (currentPfp === kingPicture ? defaultPicture : currentPfp);
              
              // Update database if profile picture needs to change
              if (newPfp !== currentPfp) {
                db.run('UPDATE users SET profilePicture = ? WHERE id = ?', [newPfp, userId], (updateErr) => {
                  if (updateErr) {
                    console.error('Error updating profile picture:', updateErr);
                  }
                });
              }
              
              res.render('profile.ejs', { 
                user: req.session.user, 
                xp: currentXP, 
                level: currentLevel, 
                xpForNextLevel,
                profilePicture: newPfp,
                isFirstPlace: shouldHaveKing
              });
            }
          });
        }
      );
    } else {
      res.render('profile.ejs', { 
        user: req.session.user, 
        xp: 0, 
        level: 1, 
        xpForNextLevel: 100,
        profilePicture: '/img/pfp.png',
        isFirstPlace: false
      });
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

  // API endpoint to purchase battle pass premium
  app.post('/api/purchase-premium', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    // Check if user already has premium
    db.get('SELECT hasBattlePassPremium FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) {
        console.error('Error checking premium status:', err);
        return res.json({ success: false, message: 'Database error' });
      }

      if (user?.hasBattlePassPremium === 1) {
        return res.json({ success: false, message: 'You already own the Premium Pass!' });
      }

      // In a real implementation, you would:
      // 1. Check if user has enough currency/digipogs
      // 2. Deduct the cost from their balance
      // 3. Then grant premium access
      
      // For now, just grant premium access
      db.run('UPDATE users SET hasBattlePassPremium = 1 WHERE id = ?', [userId], (updateErr) => {
        if (updateErr) {
          console.error('Error updating premium status:', updateErr);
          return res.json({ success: false, message: 'Failed to update premium status' });
        }

        res.json({ success: true, message: 'Premium Pass purchased successfully!' });
      });
    });
  });

  app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
  });
}

module.exports = { setupRoutes };
