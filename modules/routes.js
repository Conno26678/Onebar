const express = require('express');
const { isAuthenticated, handleLogin } = require('./middleware');
const { games } = require('./game');
const paymentRouter = require('./payment');
const db = require('../util/database');
const FORMBAR_ADDRESS = process.env.FORMBAR_ADDRESS || 'https://formbeta.yorktechapps.com';

function setupRoutes(app) {
  // Mount payment routes (must be before other routes to handle POST requests)
  app.use('/', paymentRouter);
  
  app.get('/login', handleLogin);

  app.get('/', isAuthenticated, (req, res) => {
    res.render('index.ejs', { user: req.session.user });
  });

  app.get('/game', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    if (userId) {
      db.get('SELECT selectedEmotes, selectedEffect, distractionsInventory, selectedSoundPack, customSounds FROM users WHERE id = ?', [userId], (err, userData) => {
        const selectedEmotes = userData?.selectedEmotes || '["wave","thumbsup","party","fire"]';
        const selectedEffect = userData?.selectedEffect || 'confetti';
        const distractionsInventory = userData?.distractionsInventory || '{}';
        const selectedSoundPack = userData?.selectedSoundPack || 'default';
        const customSounds = userData?.customSounds || '{}';
        res.render('game.ejs', { 
          user: req.session.user, 
          gameId: req.query.gameId || 'default',
          selectedEmotes: selectedEmotes,
          selectedEffect: selectedEffect,
          distractionsInventory: distractionsInventory,
          selectedSoundPack: selectedSoundPack,
          customSounds: customSounds
        });
      });
    } else {
      res.render('game.ejs', { 
        user: req.session.user, 
        gameId: req.query.gameId || 'default',
        selectedEmotes: '["wave","thumbsup","party","fire"]',
        selectedEffect: 'confetti',
        distractionsInventory: '{}',
        selectedSoundPack: 'default',
        customSounds: '{}'
      });
    }
  });

  app.get('/lobby', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    if (userId) {
      db.get('SELECT selectedEmotes, selectedTheme FROM users WHERE id = ?', [userId], (err, userData) => {
        const selectedEmotes = userData?.selectedEmotes || '["wave","thumbsup","party","fire"]';
        const selectedTheme = userData?.selectedTheme || 'default';
        res.render('lobby.ejs', { 
          user: req.session.user,
          selectedEmotes: selectedEmotes,
          selectedTheme: selectedTheme
        });
      });
    } else {
      res.render('lobby.ejs', { 
        user: req.session.user,
        selectedEmotes: '["wave","thumbsup","party","fire"]',
        selectedTheme: 'default'
      });
    }
  });

  app.get('/shop', isAuthenticated, async (req, res) => {
    const userId = req.session.token?.id;
    if (userId) {
      try {
        // Fetch onecells and purchasedThemes from local DB
        const userData = await new Promise((resolve, reject) => {
          db.get('SELECT onecells, purchasedThemes FROM users WHERE id = ?', [userId], (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        
        const onecells = userData?.onecells || 0;
        let purchasedThemes = [];
        
        try {
          purchasedThemes = JSON.parse(userData?.purchasedThemes || '[]');
        } catch (e) {
          purchasedThemes = [];
        }
        
        res.render('shop.ejs', { 
          user: req.session.user, 
          onecells,
          digipogs: 0,
          purchasedThemes
        });
      } catch (err) {
        console.error('Error fetching shop data:', err);
        res.render('shop.ejs', { user: req.session.user, onecells: 0, digipogs: 0, purchasedThemes: [] });
      }
    } else {
      res.render('shop.ejs', { user: req.session.user, onecells: 0, digipogs: 0, purchasedThemes: [] });
    }
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
          db.get('SELECT xp, level, profilePicture, selectedTitle, selectedTitleColor, selectedTheme, selectedSoundPack, selectedBadge, selectedEmote, selectedEmotes, selectedEffect, wins, hasBattlePassPremium, onecells, purchasedThemes, distractionsInventory, mysteryBoxInventory, customSounds FROM users WHERE id = ?', [userId], (err, userData) => {
            if (err) {
              console.error('Error fetching user data:', err);
              res.render('profile.ejs', { 
                user: req.session.user, 
                xp: 0, 
                level: 1, 
                xpForNextLevel: 100,
                profilePicture: defaultPicture,
                isFirstPlace: false,
                selectedTitle: 'Newbie',
                selectedTitleColor: 'white',
                selectedTheme: 'default',
                selectedSoundPack: 'default',
                selectedBadge: 'none',
                selectedEmote: 'wave',
                selectedEmotes: '["wave","thumbsup","party","fire"]',
                selectedEffect: 'confetti',
                wins: 0,
                hasBattlePassPremium: false,
                onecells: 0,
                digipogs: 0,
                purchasedThemes: '[]',
                distractionsInventory: '{}',
                mysteryBoxInventory: '{}',
                customSounds: '{}'
              });
            } else {
              const currentXP = userData?.xp || 0;
              const currentLevel = userData?.level || 1;
              const xpForNextLevel = db.calculateXPForLevel(currentLevel + 1);
              const currentPfp = userData?.profilePicture || defaultPicture;
              
              let purchasedThemes = [];
              try {
                purchasedThemes = JSON.parse(userData?.purchasedThemes || '[]');
              } catch (e) {
                purchasedThemes = [];
              }
              
              let distractionsInventory = {};
              try {
                distractionsInventory = JSON.parse(userData?.distractionsInventory || '{}');
              } catch (e) {
                distractionsInventory = {};
              }
              
              let mysteryBoxInventory = {};
              try {
                mysteryBoxInventory = JSON.parse(userData?.mysteryBoxInventory || '{}');
              } catch (e) {
                mysteryBoxInventory = {};
              }
              
              res.render('profile.ejs', { 
                user: req.session.user, 
                xp: currentXP, 
                level: currentLevel, 
                xpForNextLevel,
                profilePicture: currentPfp,
                isFirstPlace: shouldHaveKing,
                selectedTitle: userData?.selectedTitle || 'Newbie',
                selectedTitleColor: userData?.selectedTitleColor || 'white',
                selectedTheme: userData?.selectedTheme || 'default',
                selectedSoundPack: userData?.selectedSoundPack || 'default',
                selectedBadge: userData?.selectedBadge || 'none',
                selectedEmote: userData?.selectedEmote || 'wave',
                selectedEmotes: userData?.selectedEmotes || '["wave","thumbsup","party","fire"]',
                selectedEffect: userData?.selectedEffect || 'sparkles',
                wins: userData?.wins || 0,
                hasBattlePassPremium: userData?.hasBattlePassPremium || false,
                onecells: userData?.onecells || 0,
                digipogs: userData?.digipogs || 0,
                purchasedThemes: JSON.stringify(purchasedThemes),
                distractionsInventory: JSON.stringify(distractionsInventory),
                mysteryBoxInventory: JSON.stringify(mysteryBoxInventory),
                customSounds: userData?.customSounds || '{}'
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
        isFirstPlace: false,
        selectedTitle: 'Newbie',
        selectedTitleColor: 'white',
        selectedTheme: 'default',
        selectedSoundPack: 'default',
        selectedBadge: 'none',
        selectedEmote: 'wave',
        selectedEmotes: '["wave","thumbsup","party","fire"]',
        selectedEffect: 'confetti',
        wins: 0,
        hasBattlePassPremium: false,
        onecells: 0,
        digipogs: 0,
        purchasedThemes: '[]',
        distractionsInventory: '{}',
        mysteryBoxInventory: '{}',
        customSounds: '{}'
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
  app.post('/api/purchase-premium', isAuthenticated, async (req, res) => {
    const userId = req.session.token?.id;
    const { pin } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    if (!pin) {
      return res.json({ success: false, message: 'PIN is required' });
    }

    // Check if user already has premium
    db.get('SELECT hasBattlePassPremium FROM users WHERE id = ?', [userId], async (err, user) => {
      if (err) {
        console.error('Error checking premium status:', err);
        return res.json({ success: false, message: 'Database error' });
      }

      if (user?.hasBattlePassPremium === 1) {
        return res.json({ success: false, message: 'You already own the Premium Pass!' });
      }

      try {
        // Transfer 1000 digipogs to server owner (ID 33) using external API
        const transferPayload = {
          from: Number(userId),
          to: 33, // Server owner
          amount: 1000,
          pin: Number(pin),
          reason: `Purchase Premium Battle Pass`
        };

        const transferResult = await fetch(`${FORMBAR_ADDRESS}/api/digipogs/transfer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(transferPayload)
        });

        const contentType = transferResult.headers.get('content-type');
        let responseJson;

        if (contentType && contentType.includes('application/json')) {
          responseJson = await transferResult.json();
        } else {
          const responseText = await transferResult.text();
          console.error('Transfer API returned non-JSON response:', responseText.substring(0, 200));
          return res.json({ 
            success: false, 
            message: 'Purchase failed: Server error' 
          });
        }

        // Check if the transfer was successful
        if (transferResult.ok && responseJson) {
          console.log('Premium pass purchase transfer successful:', JSON.stringify(responseJson).substring(0, 200));
          
          // Grant premium access
          db.run('UPDATE users SET hasBattlePassPremium = 1 WHERE id = ?', [userId], (updateErr) => {
            if (updateErr) {
              console.error('Error updating premium status:', updateErr);
              return res.json({ success: false, message: 'Failed to update premium status' });
            }

            console.log(`User ${userId} purchased Premium Battle Pass for 1000 Digipogs`);
            res.json({ 
              success: true, 
              message: 'Premium Pass purchased successfully!' 
            });
          });
        } else {
          // Extract error message
          let errorMessage = 'Insufficient Digipogs or invalid PIN';
          
          if (responseJson && responseJson.token) {
            try {
              const jwt = require('jsonwebtoken');
              const decoded = jwt.decode(responseJson.token);
              if (decoded && decoded.message) {
                errorMessage = decoded.message;
              }
            } catch (decodeErr) {
              console.error('Failed to decode JWT token:', decodeErr);
            }
          }

          if (errorMessage === 'Insufficient Digipogs or invalid PIN' && responseJson) {
            if (responseJson.message) errorMessage = responseJson.message;
            else if (responseJson.error) errorMessage = responseJson.error;
          }

          console.error(`Premium purchase failed for user ${userId}:`, errorMessage);
          return res.json({ 
            success: false, 
            message: errorMessage
          });
        }
      } catch (error) {
        console.error('Premium purchase error:', error);
        return res.json({ 
          success: false, 
          message: 'Purchase failed: ' + (error.message || 'Unknown error') 
        });
      }
    });
  });

  // API endpoint to buy onecells with digipogs
  app.post('/api/buy-onecells', isAuthenticated, async (req, res) => {
    const userId = req.session.token?.id;
    const { amount, cost, pin } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    if (!amount || !cost || amount <= 0 || cost <= 0) {
      return res.json({ success: false, message: 'Invalid amount or cost' });
    }

    if (!pin) {
      return res.json({ success: false, message: 'PIN is required' });
    }

    // Validate the transaction (prevent cheating)
    const validTransactions = [
      { amount: 10, cost: 50 },
      { amount: 25, cost: 100 },
      { amount: 50, cost: 180 },
      { amount: 100, cost: 350 }
    ];

    const isValid = validTransactions.some(t => t.amount === amount && t.cost === cost);
    if (!isValid) {
      return res.json({ success: false, message: 'Invalid transaction' });
    }

    try {
      // Transfer digipogs to the server owner (ID 33) using external API
      const transferPayload = {
        from: Number(userId),
        to: 33, // Server owner
        amount: Number(cost),
        pin: Number(pin),
        reason: `Purchase ${amount} Onecells in shop`
      };

      const transferResult = await fetch(`${FORMBAR_ADDRESS}/api/digipogs/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transferPayload)
      });

      const contentType = transferResult.headers.get('content-type');
      let responseJson;

      if (contentType && contentType.includes('application/json')) {
        responseJson = await transferResult.json();
      } else {
        const responseText = await transferResult.text();
        console.error('Transfer API returned non-JSON response:', responseText.substring(0, 200));
        return res.json({ 
          success: false, 
          message: 'Purchase failed: Server error' 
        });
      }

      // Check if the transfer was successful
      if (transferResult.ok && responseJson) {
        console.log('Transfer successful, response:', JSON.stringify(responseJson).substring(0, 200));
        
        // Add onecells to user's local account
        db.get('SELECT onecells FROM users WHERE id = ?', [userId], (err, userData) => {
          if (err) {
            console.error('Error fetching user onecells:', err);
            return res.status(200).json({ success: false, message: 'Database error' });
          }

          const currentOnecells = userData?.onecells || 0;
          const newOnecells = currentOnecells + amount;

          db.run(
            'UPDATE users SET onecells = ? WHERE id = ?', 
            [newOnecells, userId], 
            (updateErr) => {
              if (updateErr) {
                console.error('Error updating onecells:', updateErr);
                return res.status(200).json({ success: false, message: 'Failed to add onecells' });
              }

              // Fetch updated digipogs balance from external API
              fetchDigipogsBalance(userId).then(newDigipogs => {
                console.log(`User ${userId} bought ${amount} Onecells for ${cost} Digipogs - Success!`);
                res.status(200).json({ 
                  success: true, 
                  message: `Successfully purchased ${amount} Onecells!`,
                  newOnecells,
                  newDigipogs
                });
              }).catch(balanceError => {
                console.error('Error fetching updated balance:', balanceError);
                // Still return success since the purchase went through
                console.log(`User ${userId} bought ${amount} Onecells for ${cost} Digipogs - Success (balance fetch failed)`);
                res.status(200).json({ 
                  success: true, 
                  message: `Successfully purchased ${amount} Onecells!`,
                  newOnecells,
                  newDigipogs: 0 // Fallback value
                });
              });
            }
          );
        });
      } else {
        console.log('Transfer failed. Status:', transferResult.status, 'Response:', JSON.stringify(responseJson).substring(0, 200));
        
        // Extract error message
        let errorMessage = 'Purchase failed';
        
        if (responseJson && responseJson.token) {
          try {
            const jwt = require('jsonwebtoken');
            const decoded = jwt.decode(responseJson.token);
            console.log('Decoded token:', decoded);
            if (decoded && decoded.message) {
              errorMessage = decoded.message;
            }
          } catch (err) {
            console.error('Failed to decode JWT token:', err);
          }
        }

        if (errorMessage === 'Purchase failed' && responseJson) {
          if (responseJson.message) {
            errorMessage = responseJson.message;
          } else if (responseJson.error) {
            errorMessage = responseJson.error;
          }
        }

        console.error(`Onecells purchase failed for user ${userId}:`, errorMessage);
        return res.json({ success: false, message: errorMessage });
      }
    } catch (err) {
      console.error('Error processing onecells purchase:', err);
      return res.json({ success: false, message: 'Purchase failed: Network error' });
    }
  });

  // API endpoint to purchase themes with onecells
  app.post('/api/purchase-theme', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { themeId } = req.body;

    if (!userId) {
      return res.status(200).json({ success: false, message: 'User not authenticated' });
    }

    // Define theme prices and names
    const themes = {
      'isaiah': { name: 'Isaiah Theme', price: 75, themeValue: 'isaiah' },
      'john': { name: 'John Showman Theme', price: 50, themeValue: 'john' },
      'robert': { name: 'Robert Theme', price: 125, themeValue: 'robert' },
      'peak': { name: 'Chickens Memory Theme', price: 100, themeValue: 'peak' }
    };

    const theme = themes[themeId];
    if (!theme) {
      return res.status(200).json({ success: false, message: 'Invalid theme' });
    }

    // Get user's current onecells and purchased themes
    db.get('SELECT onecells, purchasedThemes FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.status(200).json({ success: false, message: 'Database error' });
      }

      const currentOnecells = userData?.onecells || 0;
      let purchasedThemes = [];
      
      try {
        purchasedThemes = JSON.parse(userData?.purchasedThemes || '[]');
      } catch (e) {
        purchasedThemes = [];
      }

      // Check if user already owns this theme
      if (purchasedThemes.includes(theme.themeValue)) {
        return res.status(200).json({ success: false, message: 'You already own this theme!' });
      }

      // Check if user has enough onecells
      if (currentOnecells < theme.price) {
        return res.status(200).json({ 
          success: false, 
          message: `Not enough Onecells! You need ${theme.price} Onecells (you have ${currentOnecells})` 
        });
      }

      // Deduct onecells and add theme to purchased list
      const newOnecells = currentOnecells - theme.price;
      purchasedThemes.push(theme.themeValue);
      const updatedThemes = JSON.stringify(purchasedThemes);

      db.run(
        'UPDATE users SET onecells = ?, purchasedThemes = ?, selectedTheme = ? WHERE id = ?',
        [newOnecells, updatedThemes, theme.themeValue, userId],
        (updateErr) => {
          if (updateErr) {
            console.error('Error purchasing theme:', updateErr);
            return res.status(200).json({ success: false, message: 'Failed to purchase theme' });
          }

          console.log(`User ${userId} purchased ${theme.name} for ${theme.price} Onecells`);
          return res.status(200).json({
            success: true,
            message: `Successfully purchased ${theme.name}! It has been equipped.`,
            newOnecells,
            theme: theme.themeValue
          });
        }
      );
    });
  });

  // API endpoint to purchase free games in bulk
  app.post('/api/purchase-free-games', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { quantity, price } = req.body;

    if (!userId) {
      return res.status(200).json({ success: false, message: 'User not authenticated' });
    }

    // Validate quantity and price
    const validPurchases = {
      5: 200,
      10: 400,
      15: 550,
      20: 700
    };

    if (!validPurchases[quantity] || validPurchases[quantity] !== price) {
      return res.status(200).json({ success: false, message: 'Invalid purchase option' });
    }

    // Get user's current onecells and freeGameTokens
    db.get('SELECT onecells, freeGameTokens FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.status(200).json({ success: false, message: 'Database error' });
      }

      const currentOnecells = userData?.onecells || 0;
      const currentTokens = userData?.freeGameTokens || 0;

      // Check if user has enough onecells
      if (currentOnecells < price) {
        return res.status(200).json({ 
          success: false, 
          message: `Not enough Onecells! You need ${price} but only have ${currentOnecells}` 
        });
      }

      // Deduct onecells and add free game tokens
      const newOnecells = currentOnecells - price;
      const newTokens = currentTokens + quantity;

      db.run(
        'UPDATE users SET onecells = ?, freeGameTokens = ? WHERE id = ?',
        [newOnecells, newTokens, userId],
        (updateErr) => {
          if (updateErr) {
            console.error('Error purchasing free games:', updateErr);
            return res.status(200).json({ success: false, message: 'Failed to complete purchase' });
          }

          console.log(`User ${userId} purchased ${quantity} free game tokens for ${price} Onecells. New balance: ${newTokens} tokens`);
          return res.status(200).json({
            success: true,
            message: `Successfully purchased ${quantity} Free Game Tokens!`,
            newOnecells,
            newTokens
          });
        }
      );
    });
  });

  // API endpoint to purchase distractions
  app.post('/api/purchase-distraction', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { type, quantity, totalPrice } = req.body;

    if (!userId) {
      return res.status(200).json({ success: false, message: 'User not authenticated' });
    }

    // Validate distraction type
    const validTypes = ['Flashbang', 'Jumpscare', 'SubwaySurfers', 'PeterGriffin', 'Shake', 'SixSeven', 'Trollface'];
    if (!validTypes.includes(type)) {
      return res.status(200).json({ success: false, message: 'Invalid distraction type' });
    }

    // Validate quantity and price (5 Onecells per distraction)
    const pricePerUnit = 5;
    const expectedPrice = quantity * pricePerUnit;
    
    if (quantity < 1 || quantity > 50 || totalPrice !== expectedPrice) {
      return res.status(200).json({ success: false, message: 'Invalid purchase details' });
    }

    // Get user's current onecells and distractions inventory
    db.get('SELECT onecells, distractionsInventory FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.status(200).json({ success: false, message: 'Database error' });
      }

      const currentOnecells = userData?.onecells || 0;
      let inventory = {};
      try {
        inventory = JSON.parse(userData?.distractionsInventory || '{}');
      } catch (e) {
        inventory = {};
      }

      // Check if user has enough onecells
      if (currentOnecells < totalPrice) {
        return res.status(200).json({ 
          success: false, 
          message: `Not enough Onecells! You need ${totalPrice} but only have ${currentOnecells}` 
        });
      }

      // Deduct onecells and add to inventory
      const newOnecells = currentOnecells - totalPrice;
      inventory[type] = (inventory[type] || 0) + quantity;
      const updatedInventory = JSON.stringify(inventory);

      db.run(
        'UPDATE users SET onecells = ?, distractionsInventory = ? WHERE id = ?',
        [newOnecells, updatedInventory, userId],
        (updateErr) => {
          if (updateErr) {
            console.error('Error purchasing distraction:', updateErr);
            return res.status(200).json({ success: false, message: 'Failed to complete purchase' });
          }

          console.log(`User ${userId} purchased ${quantity} ${type} distraction(s) for ${totalPrice} Onecells`);
          return res.status(200).json({
            success: true,
            message: `Successfully purchased ${quantity} ${type} Distraction(s)!`,
            newOnecells
          });
        }
      );
    });
  });

  // API endpoint to purchase mystery boxes
  app.post('/api/purchase-mystery-box', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { boxType, price } = req.body;

    if (!userId) {
      return res.status(200).json({ success: false, message: 'User not authenticated' });
    }

    // Log received data for debugging
    console.log(`Mystery box purchase attempt - boxType: ${boxType}, price: ${price}, priceType: ${typeof price}`);

    // Validate box type and price
    const validBoxes = {
      'standard': 15
    };

    // Convert price to number to handle both string and number inputs
    const priceNum = parseInt(price);

    if (!validBoxes.hasOwnProperty(boxType)) {
      console.log(`Invalid box type: ${boxType}`);
      return res.status(200).json({ success: false, message: `Invalid mystery box type: ${boxType}` });
    }

    if (validBoxes[boxType] !== priceNum) {
      console.log(`Price mismatch - expected: ${validBoxes[boxType]}, got: ${priceNum}`);
      return res.status(200).json({ success: false, message: `Invalid price. Expected ${validBoxes[boxType]} Onecells` });
    }

    // Get user's current onecells and mystery box inventory
    db.get('SELECT onecells, mysteryBoxInventory FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.status(200).json({ success: false, message: 'Database error' });
      }

      const currentOnecells = userData?.onecells || 0;
      let inventory = {};
      try {
        inventory = JSON.parse(userData?.mysteryBoxInventory || '{}');
      } catch (e) {
        inventory = {};
      }

      // Check if user has enough onecells
      if (currentOnecells < priceNum) {
        return res.status(200).json({ 
          success: false, 
          message: `Not enough Onecells! You need ${priceNum} but only have ${currentOnecells}` 
        });
      }

      // Deduct onecells and add to inventory
      const newOnecells = currentOnecells - priceNum;
      inventory[boxType] = (inventory[boxType] || 0) + 1;
      const updatedInventory = JSON.stringify(inventory);

      db.run(
        'UPDATE users SET onecells = ?, mysteryBoxInventory = ? WHERE id = ?',
        [newOnecells, updatedInventory, userId],
        (updateErr) => {
          if (updateErr) {
            console.error('Error purchasing mystery box:', updateErr);
            return res.status(200).json({ success: false, message: 'Failed to complete purchase' });
          }

          console.log(`User ${userId} purchased Mystery Box for ${priceNum} Onecells`);
          return res.status(200).json({
            success: true,
            message: `Successfully purchased Mystery Box!`,
            newOnecells
          });
        }
      );
    });
  });

  // API endpoint to open mystery boxes
  app.post('/api/open-mystery-box', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { boxType } = req.body;

    if (!userId) {
      return res.status(200).json({ success: false, message: 'User not authenticated' });
    }

    // Get user data including inventory, custom sounds, purchased themes, and digipogs
    db.get('SELECT mysteryBoxInventory, customSounds, purchasedThemes, distractionsInventory FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.status(200).json({ success: false, message: 'Database error' });
      }

      let inventory = {};
      try {
        inventory = JSON.parse(userData?.mysteryBoxInventory || '{}');
      } catch (e) {
        inventory = {};
      }

      // Check if user has a box of this type
      if (!inventory[boxType] || inventory[boxType] <= 0) {
        return res.status(200).json({ 
          success: false, 
          message: 'You don\'t have any boxes to open!' 
        });
      }

      // Loot tables with weighted probabilities
      const lootTable = {
        // COMMON: Custom sounds (70% total chance)
        customSounds: {
          weight: 70,
          items: [
            { id: 'loading_yeahoo', name: 'Yeahoo Loading Sound', soundType: 'loading', path: '/sfx/yeahoo.mp3', value: 10 },
            { id: 'win_allidoiswin', name: 'All I Do Is Win', soundType: 'win', path: '/sfx/allidoiswin.mp3', value: 10 },
            { id: 'win_finalcountdown', name: 'The Final Countdown', soundType: 'win', path: '/sfx/thefinalcountdown.mp3', value: 10 },
            { id: 'win_wearechampions', name: 'We Are The Champions', soundType: 'win', path: '/sfx/wearethechampions.mp3', value: 10 },
            { id: 'win_yourethebest', name: 'You\'re The Best', soundType: 'win', path: '/sfx/yourethebest.mp3', value: 10 },
            { id: 'skip_fnafjumpscare', name: 'FNAF Jumpscare Skip', soundType: 'skip', path: '/sfx/fnafjumpscare.mp3', value: 10 },
            { id: 'plus2_peterlaugh', name: 'Peter Laugh +2', soundType: 'plus2', path: '/sfx/peterlaugh.mp3', value: 10 },
            { id: 'wild_imspongebob', name: 'I\'m Spongebob Wild', soundType: 'wild', path: '/sfx/imspongebob.mp3', value: 10 },
            { id: 'plus4_blowmeaway', name: 'Blow Me Away +4', soundType: 'plus4', path: '/sfx/blowmeaway.mp3', value: 10 },
            { id: 'reverse_avengedsevenfold', name: 'Avenged Sevenfold Reverse', soundType: 'reverse', path: '/sfx/avengedsevenfold.mp3', value: 10 }
          ]
        },
        // RARE: Themes, Free Games, Distractions (30% total chance)
        rareItems: {
          weight: 30,
          items: [
            { id: 'theme_isaiah', name: 'Isaiah Theme', type: 'theme', value: 75 },
            { id: 'theme_john', name: 'John Showman Theme', type: 'theme', value: 50 },
            { id: 'theme_robert', name: 'Robert Theme', type: 'theme', value: 125 },
            { id: 'freegame_1', name: '1 Free Game', type: 'freeGame', amount: 1, value: 0 },
            { id: 'freegame_3', name: '3 Free Games', type: 'freeGame', amount: 3, value: 0 },
            { id: 'distraction_trollface', name: 'Trollface Distraction (x2)', type: 'distraction', distractionType: 'Trollface', amount: 2, value: 0 },
            { id: 'distraction_subwaysurfers', name: 'Subway Surfers Distraction (x2)', type: 'distraction', distractionType: 'SubwaySurfers', amount: 2, value: 0 },
            { id: 'distraction_sixseven', name: 'Six Seven Distraction (x2)', type: 'distraction', distractionType: 'SixSeven', amount: 2, value: 0 }
          ]
        }
      };

      // Weighted random selection
      const totalWeight = lootTable.customSounds.weight + lootTable.rareItems.weight;
      const roll = Math.random() * totalWeight;
      
      let selectedCategory;
      if (roll < lootTable.customSounds.weight) {
        selectedCategory = lootTable.customSounds;
      } else {
        selectedCategory = lootTable.rareItems;
      }

      // Pick random item from selected category
      const randomItem = selectedCategory.items[Math.floor(Math.random() * selectedCategory.items.length)];

      // Parse existing data
      let customSounds = {};
      let purchasedThemes = [];
      let distractionsInventory = {};
      
      try {
        customSounds = JSON.parse(userData?.customSounds || '{}');
      } catch (e) {
        console.error('Error parsing customSounds:', e);
        customSounds = {};
      }
      
      try {
        purchasedThemes = JSON.parse(userData?.purchasedThemes || '[]');
      } catch (e) {
        console.error('Error parsing purchasedThemes:', e);
        purchasedThemes = [];
      }
      
      try {
        distractionsInventory = JSON.parse(userData?.distractionsInventory || '{}');
      } catch (e) {
        console.error('Error parsing distractionsInventory:', e);
        distractionsInventory = {};
      }

      let isDuplicate = false;
      let digipogsEarned = 0;
      let updates = {};

      // Handle different item types
      if (randomItem.soundType) {
        // Custom sound
        console.log(`Checking sound duplicate: soundType='${randomItem.soundType}', path='${randomItem.path}'`);
        console.log(`Current customSounds:`, customSounds);
        if (customSounds[randomItem.soundType] === randomItem.path) {
          isDuplicate = true;
          digipogsEarned = randomItem.value;
          console.log(`Duplicate sound detected! Awarding ${digipogsEarned} Onecells`);
        } else {
          customSounds[randomItem.soundType] = randomItem.path;
          updates.customSounds = JSON.stringify(customSounds);
          console.log(`New sound unlocked: ${randomItem.soundType} = ${randomItem.path}`);
        }
      } else if (randomItem.type === 'theme') {
        // Theme
        const themeId = randomItem.id.replace('theme_', '');
        console.log(`Checking theme duplicate: themeId='${themeId}'`);
        console.log(`Current purchasedThemes:`, purchasedThemes);
        if (purchasedThemes.includes(themeId)) {
          isDuplicate = true;
          digipogsEarned = randomItem.value;
          console.log(`Duplicate theme detected! Awarding ${digipogsEarned} Onecells`);
        } else {
          purchasedThemes.push(themeId);
          updates.purchasedThemes = JSON.stringify(purchasedThemes);
          console.log(`New theme unlocked: ${themeId}`);
        }
      } else if (randomItem.type === 'freeGame') {
        // Free games - never duplicates, always add
        updates.freeGameTokens = `freeGameTokens + ${randomItem.amount}`;
        console.log(`Free game tokens granted: ${randomItem.amount}`);
      } else if (randomItem.type === 'distraction') {
        // Distractions - never duplicates, always add (give amount specified)
        const amountToAdd = randomItem.amount || 1;
        distractionsInventory[randomItem.distractionType] = (distractionsInventory[randomItem.distractionType] || 0) + amountToAdd;
        updates.distractionsInventory = JSON.stringify(distractionsInventory);
      }

      // Decrease box count
      inventory[boxType] = inventory[boxType] - 1;
      if (inventory[boxType] <= 0) {
        delete inventory[boxType];
      }
      updates.mysteryBoxInventory = JSON.stringify(inventory);

      // Build update query
      let updateFields = [];
      let updateValues = [];
      
      Object.entries(updates).forEach(([key, value]) => {
        if (key === 'freeGameTokens') {
          updateFields.push(`freeGameTokens = ${value}`);
        } else {
          updateFields.push(`${key} = ?`);
          updateValues.push(value);
        }
      });

      // Add onecells if duplicate
      if (isDuplicate) {
        updateFields.push('onecells = onecells + ?');
        updateValues.push(digipogsEarned);
      }

      updateValues.push(userId);

      const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;

      db.run(updateQuery, updateValues, (updateErr) => {
        if (updateErr) {
          console.error('Error opening mystery box:', updateErr);
          return res.status(200).json({ success: false, message: 'Failed to open mystery box' });
        }

        console.log(`User ${userId} opened Mystery Box and received: ${randomItem.name}${isDuplicate ? ' (duplicate, converted to Onecells)' : ''}`);
        
        return res.status(200).json({
          success: true,
          reward: {
            name: randomItem.name,
            isDuplicate: isDuplicate,
            onecellsEarned: digipogsEarned,
            type: randomItem.soundType ? 'customSound' : randomItem.type
          }
        });
      });
    });
  });

  // API endpoint to update profile picture
  app.post('/api/update-profile-picture', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { profilePicture } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    if (!profilePicture) {
      return res.json({ success: false, message: 'No profile picture provided' });
    }

    // Validate the profile picture path to prevent unauthorized access
    const allowedPictures = [
      '/img/pfp.png',
      '/img/king.png',
      '/img/Smiffers1984.png',
      '/img/Hayden.png',
      '/img/partySmith.png',
      '/img/glassesSmith.jpeg',
      '/img/closeUpSmith.png',
      '/img/smithHidingSpot.png',
      '/img/disasmithed.png',
      '/img/cornConnor.jpg'
    ];

    if (!allowedPictures.includes(profilePicture)) {
      return res.json({ success: false, message: 'Invalid profile picture' });
    }

    // Get user data to check unlock requirements
    db.get('SELECT level, wins FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.json({ success: false, message: 'Database error' });
      }

      const userLevel = userData?.level || 1;
      const userWins = userData?.wins || 0;
      
      // Check if user has unlocked this picture
      let unlocked = true;
      if (profilePicture === '/img/Smiffers1984.png' && userLevel < 10) unlocked = false;
      if (profilePicture === '/img/Hayden.png' && userLevel < 25) unlocked = false;
      if (profilePicture === '/img/partySmith.png' && userLevel < 30) unlocked = false;
      if (profilePicture === '/img/glassesSmith.jpeg' && userLevel < 45) unlocked = false;
      if (profilePicture === '/img/closeUpSmith.png' && userLevel < 48) unlocked = false;
      if (profilePicture === '/img/smithHidingSpot.png' && userLevel < 50) unlocked = false;
      if (profilePicture === '/img/disasmithed.png' && userWins < 100) unlocked = false;
      if (profilePicture === '/img/cornConnor.jpg' && userWins < 100) unlocked = false;
      
      // King is handled separately by leaderboard position, skip it here
      if (profilePicture === '/img/king.png') {
        // Check if user is first place
        db.get(
          'SELECT id FROM users WHERE gamesPlayed > 0 ORDER BY wins DESC LIMIT 1',
          [],
          (leaderErr, firstPlaceUser) => {
            if (leaderErr || !firstPlaceUser || firstPlaceUser.id !== userId) {
              return res.json({ success: false, message: 'You must be #1 on the leaderboard to use this avatar' });
            }
            
            // Update profile picture
            db.run('UPDATE users SET profilePicture = ? WHERE id = ?', [profilePicture, userId], (updateErr) => {
              if (updateErr) {
                console.error('Error updating profile picture:', updateErr);
                return res.json({ success: false, message: 'Failed to update profile picture' });
              }
              res.json({ success: true });
            });
          }
        );
        return;
      }

      if (!unlocked) {
        return res.json({ success: false, message: 'You have not unlocked this avatar yet' });
      }

      // Update profile picture in database
      db.run('UPDATE users SET profilePicture = ? WHERE id = ?', [profilePicture, userId], (updateErr) => {
        if (updateErr) {
          console.error('Error updating profile picture:', updateErr);
          return res.json({ success: false, message: 'Failed to update profile picture' });
        }

        res.json({ success: true });
      });
    });
  });

  // API endpoint to update title
  app.post('/api/update-title', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { title } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    if (!title) {
      return res.json({ success: false, message: 'No title provided' });
    }

    // Get user data to check unlock requirements
    db.get('SELECT level FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.json({ success: false, message: 'Database error' });
      }

      const userLevel = userData?.level || 1;
      
      // Define title requirements
      const titleRequirements = {
        'Newbie': 1,
        'Player': 5,
        'Competitor': 10,
        'Champion': 20,
        'Legend': 35,
        'Master': 50,
        'Max Gamer': 50
      };

      if (!titleRequirements.hasOwnProperty(title)) {
        return res.json({ success: false, message: 'Invalid title' });
      }

      if (userLevel < titleRequirements[title]) {
        return res.json({ success: false, message: 'You have not unlocked this title yet' });
      }

      // Update title in database
      db.run('UPDATE users SET selectedTitle = ? WHERE id = ?', [title, userId], (updateErr) => {
        if (updateErr) {
          console.error('Error updating title:', updateErr);
          return res.json({ success: false, message: 'Failed to update title' });
        }

        res.json({ success: true });
      });
    });
  });

  // API endpoint to update title color
  app.post('/api/update-title-color', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { titleColor } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    if (!titleColor) {
      return res.json({ success: false, message: 'No title color provided' });
    }

    // Get user data to check unlock requirements
    db.get('SELECT level FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.json({ success: false, message: 'Database error' });
      }

      const userLevel = userData?.level || 1;
      
      // Define title color requirements
      const titleColorRequirements = {
        'white': 1,
        'purple': 5,
        'blue': 10
      };

      if (!titleColorRequirements.hasOwnProperty(titleColor)) {
        return res.json({ success: false, message: 'Invalid title color' });
      }

      if (userLevel < titleColorRequirements[titleColor]) {
        return res.json({ success: false, message: 'You have not unlocked this title color yet' });
      }

      // Update title color in database
      db.run('UPDATE users SET selectedTitleColor = ? WHERE id = ?', [titleColor, userId], (updateErr) => {
        if (updateErr) {
          console.error('Error updating title color:', updateErr);
          return res.json({ success: false, message: 'Failed to update title color' });
        }

        res.json({ success: true });
      });
    });
  });

  // API endpoint to update theme
  app.post('/api/update-theme', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { theme } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    if (!theme) {
      return res.json({ success: false, message: 'No theme provided' });
    }

    // Get user data to check unlock requirements
    db.get('SELECT level, purchasedThemes FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.json({ success: false, message: 'Database error' });
      }

      const userLevel = userData?.level || 1;
      let purchasedThemes = [];
      
      try {
        purchasedThemes = JSON.parse(userData?.purchasedThemes || '[]');
      } catch (e) {
        purchasedThemes = [];
      }
      
      // Define theme requirements for Battle Pass themes
      const themeRequirements = {
        'default': 1,
        'ocean': 18,
        'forest': 21,
        'pink': 40,
        'winter': 46,
        'smith': 50
      };

      // Define purchasable themes
      const purchasableThemes = ['isaiah', 'john', 'robert', 'peak'];

      // Check if it's a Battle Pass theme
      if (themeRequirements.hasOwnProperty(theme)) {
        if (userLevel < themeRequirements[theme]) {
          return res.json({ success: false, message: 'You have not unlocked this theme yet' });
        }
      } 
      // Check if it's a purchasable theme
      else if (purchasableThemes.includes(theme)) {
        if (!purchasedThemes.includes(theme)) {
          return res.json({ success: false, message: 'You have not purchased this theme yet. Visit the shop!' });
        }
      }
      // Unknown theme
      else {
        return res.json({ success: false, message: 'Invalid theme' });
      }

      // Update theme in database
      db.run('UPDATE users SET selectedTheme = ? WHERE id = ?', [theme, userId], (updateErr) => {
        if (updateErr) {
          console.error('Error updating theme:', updateErr);
          return res.json({ success: false, message: 'Failed to update theme' });
        }

        res.json({ success: true });
      });
    });
  });

  // API endpoint to update sound pack
  app.post('/api/update-soundpack', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { soundPack } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    if (!soundPack) {
      return res.json({ success: false, message: 'No sound pack provided' });
    }

    // Get user data to check unlock requirements
    db.get('SELECT level FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.json({ success: false, message: 'Database error' });
      }

      const userLevel = userData?.level || 1;
      
      // Define sound pack requirements
      const soundPackRequirements = {
        'default': 1,
        'hayden': 25,
        'custom': 1
      };

      if (!soundPackRequirements.hasOwnProperty(soundPack)) {
        return res.json({ success: false, message: 'Invalid sound pack' });
      }

      if (userLevel < soundPackRequirements[soundPack]) {
        return res.json({ success: false, message: 'You have not unlocked this sound pack yet' });
      }

      // Update sound pack in database
      db.run('UPDATE users SET selectedSoundPack = ? WHERE id = ?', [soundPack, userId], (updateErr) => {
        if (updateErr) {
          console.error('Error updating sound pack:', updateErr);
          return res.json({ success: false, message: 'Failed to update sound pack' });
        }

        res.json({ success: true });
      });
    });
  });

  // API endpoint to update custom sounds
  app.post('/api/update-custom-sounds', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { customSounds } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    if (typeof customSounds !== 'string') {
      return res.json({ success: false, message: 'Invalid custom sounds data' });
    }

    // Validate that it's valid JSON
    try {
      JSON.parse(customSounds);
    } catch (e) {
      return res.json({ success: false, message: 'Invalid JSON format for custom sounds' });
    }

    // Update custom sounds in database
    db.run('UPDATE users SET customSounds = ? WHERE id = ?', [customSounds, userId], (updateErr) => {
      if (updateErr) {
        console.error('Error updating custom sounds:', updateErr);
        return res.json({ success: false, message: 'Failed to update custom sounds' });
      }

      res.json({ success: true });
    });
  });

  // API endpoint to update badge
  app.post('/api/update-badge', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { badge } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    if (!badge) {
      return res.json({ success: false, message: 'No badge provided' });
    }

    // Get user data to check unlock requirements
    db.get('SELECT level, wins, hasBattlePassPremium FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.json({ success: false, message: 'Database error' });
      }

      const userLevel = userData?.level || 1;
      const userWins = userData?.wins || 0;
      
      // Define badge requirements (based on level and wins)
      const badgeRequirements = {
        'none': { level: 1, wins: 0 },
        'bronze': { level: 5, wins: 10 },
        'silver': { level: 15, wins: 25 },
        'gold': { level: 30, wins: 50 },
        'trophy': { level: 45, wins: 100 },
        'diamond': { level: 1, wins: 0, requiresPremium: true }
      };

      if (!badgeRequirements.hasOwnProperty(badge)) {
        return res.json({ success: false, message: 'Invalid badge' });
      }

      const requirements = badgeRequirements[badge];
      if (userLevel < requirements.level || userWins < requirements.wins) {
        return res.json({ success: false, message: 'You have not unlocked this badge yet' });
      }
      
      // Check premium requirement for diamond badge
      if (requirements.requiresPremium && !userData?.hasBattlePassPremium) {
        return res.json({ success: false, message: 'You need Battle Pass Premium to unlock this badge' });
      }

      // Update badge in database
      db.run('UPDATE users SET selectedBadge = ? WHERE id = ?', [badge, userId], (updateErr) => {
        if (updateErr) {
          console.error('Error updating badge:', updateErr);
          return res.json({ success: false, message: 'Failed to update badge' });
        }

        res.json({ success: true });
      });
    });
  });

  // API endpoint to update emote
  app.post('/api/update-emote', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { emote } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    if (!emote) {
      return res.json({ success: false, message: 'No emote provided' });
    }

    // Get user data to check unlock requirements
    db.get('SELECT level FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.json({ success: false, message: 'Database error' });
      }

      const userLevel = userData?.level || 1;
      
      // Define emote requirements
      const emoteRequirements = {
        'wave': 1,
        'thumbsup': 5,
        'party': 15,
        'fire': 20,
        'hearteyes': 20,
        'crown': 30,
        'cool': 30,
        'cowboy': 35,
        'rocket': 40,
        'star': 50
      };

      if (!emoteRequirements.hasOwnProperty(emote)) {
        return res.json({ success: false, message: 'Invalid emote' });
      }

      if (userLevel < emoteRequirements[emote]) {
        return res.json({ success: false, message: 'You have not unlocked this emote yet' });
      }

      // Update emote in database
      db.run('UPDATE users SET selectedEmote = ? WHERE id = ?', [emote, userId], (updateErr) => {
        if (updateErr) {
          console.error('Error updating emote:', updateErr);
          return res.json({ success: false, message: 'Failed to update emote' });
        }

        res.json({ success: true });
      });
    });
  });

  // API endpoint to update multiple emojis (4 selected emojis)
  app.post('/api/update-emojis', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { emojis } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    if (!emojis || !Array.isArray(emojis) || emojis.length !== 4) {
      return res.json({ success: false, message: 'Please select exactly 4 emojis' });
    }

    // Get user data to check unlock requirements
    db.get('SELECT level, wins FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.json({ success: false, message: 'Database error' });
      }

      const userLevel = userData?.level || 1;
      const userWins = userData?.wins || 0;
      
      // Define emoji requirements
      const emojiRequirements = {
        'wave': { level: 1, wins: 0 },
        'thumbsup': { level: 5, wins: 0 },
        'party': { level: 15, wins: 0 },
        'fire': { level: 20, wins: 0 },
        'hearteyes': { level: 20, wins: 0 },
        'crown': { level: 30, wins: 0 },
        'cool': { level: 30, wins: 0 },
        'partysmith': { level: 35, wins: 0 },
        'cowboy': { level: 35, wins: 0 },
        'rocket': { level: 40, wins: 0 },
        'star': { level: 50, wins: 0 },
        'disasmithed': { level: 1, wins: 75 }
      };

      // Validate all emojis are unlocked
      for (const emoji of emojis) {
        if (!emojiRequirements.hasOwnProperty(emoji)) {
          return res.json({ success: false, message: `Invalid emoji: ${emoji}` });
        }

        const req = emojiRequirements[emoji];
        if (userLevel < req.level || userWins < req.wins) {
          return res.json({ success: false, message: `You have not unlocked ${emoji} yet` });
        }
      }

      // Update emojis in database as JSON string
      const emojisJson = JSON.stringify(emojis);
      db.run('UPDATE users SET selectedEmotes = ? WHERE id = ?', [emojisJson, userId], (updateErr) => {
        if (updateErr) {
          console.error('Error updating emojis:', updateErr);
          return res.json({ success: false, message: 'Failed to update emojis' });
        }

        res.json({ success: true });
      });
    });
  });

  // API endpoint to update effect
  app.post('/api/update-effect', isAuthenticated, (req, res) => {
    const userId = req.session.token?.id;
    const { effect, effects } = req.body;

    if (!userId) {
      return res.json({ success: false, message: 'User not authenticated' });
    }

    // Handle both single effect (legacy) and multiple effects
    let effectsToSave = [];
    if (effects && Array.isArray(effects)) {
      effectsToSave = effects;
    } else if (effect) {
      effectsToSave = [effect];
    } else {
      return res.json({ success: false, message: 'No effects provided' });
    }

    // Get user data to check unlock requirements
    db.get('SELECT level FROM users WHERE id = ?', [userId], (err, userData) => {
      if (err) {
        console.error('Error fetching user data:', err);
        return res.json({ success: false, message: 'Database error' });
      }

      const userLevel = userData?.level || 1;
      
      // Define effect requirements
      const effectRequirements = {
        'confetti': 1,
        'sparkles': 20,
        'lightning': 26,
        'skip': 31,
        'flames': 40,
        'bow': 41
      };

      // Validate all effects
      for (const eff of effectsToSave) {
        if (!effectRequirements.hasOwnProperty(eff)) {
          return res.json({ success: false, message: `Invalid effect: ${eff}` });
        }

        if (userLevel < effectRequirements[eff]) {
          return res.json({ success: false, message: `You have not unlocked ${eff} yet` });
        }
      }

      // Update effects in database as JSON array
      const effectsJson = JSON.stringify(effectsToSave);
      db.run('UPDATE users SET selectedEffect = ? WHERE id = ?', [effectsJson, userId], (updateErr) => {
        if (updateErr) {
          console.error('Error updating effects:', updateErr);
          return res.json({ success: false, message: 'Failed to update effects' });
        }

        res.json({ success: true });
      });
    });
  });

  app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
  });
}

module.exports = { setupRoutes };
