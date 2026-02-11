const express = require('express');
const { isAuthenticated, handleLogin } = require('./middleware');
const { games } = require('./game');
const paymentRouter = require('./payment');
const db = require('../util/database');
const FORMBAR_ADDRESS = process.env.FORMBAR_ADDRESS || 'https://formbeta.yorktechapps.com';

// Helper function to fetch digipogs balance from external API
async function fetchDigipogsBalance(userId) {
  try {
    const response = await fetch(`${FORMBAR_ADDRESS}/api/digipogs/balance/${userId}`);
    if (response.ok) {
      const data = await response.json();
      return data.balance || 0;
    }
    return 0;
  } catch (error) {
    console.error('Error fetching digipogs balance:', error);
    return 0;
  }
}

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
      db.get('SELECT selectedEmotes, selectedEffect, distractionsInventory FROM users WHERE id = ?', [userId], (err, userData) => {
        const selectedEmotes = userData?.selectedEmotes || '["wave","thumbsup","party","fire"]';
        const selectedEffect = userData?.selectedEffect || 'confetti';
        const distractionsInventory = userData?.distractionsInventory || '{}';
        res.render('game.ejs', { 
          user: req.session.user, 
          gameId: req.query.gameId || 'default',
          selectedEmotes: selectedEmotes,
          selectedEffect: selectedEffect,
          distractionsInventory: distractionsInventory
        });
      });
    } else {
      res.render('game.ejs', { 
        user: req.session.user, 
        gameId: req.query.gameId || 'default',
        selectedEmotes: '["wave","thumbsup","party","fire"]',
        selectedEffect: 'confetti',
        distractionsInventory: '{}'
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
        
        const digipogs = await fetchDigipogsBalance(userId);
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
          digipogs,
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
          db.get('SELECT xp, level, profilePicture, selectedTitle, selectedTitleColor, selectedTheme, selectedSoundPack, selectedBadge, selectedEmote, selectedEmotes, selectedEffect, wins, hasBattlePassPremium, onecells, purchasedThemes, distractionsInventory FROM users WHERE id = ?', [userId], async (err, userData) => {
            // Fetch digipogs from external API
            const digipogs = userId ? await fetchDigipogsBalance(userId) : 0;
            
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
                distractionsInventory: '{}'
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
              
              // Auto-assign king picture when reaching #1, but don't force removal when losing it
              // Users can manually change their picture regardless of leaderboard position
              if (shouldHaveKing && currentPfp !== kingPicture) {
                // Only auto-assign king if they're #1 and don't already have it
                db.run('UPDATE users SET profilePicture = ? WHERE id = ?', [kingPicture, userId], (updateErr) => {
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
                distractionsInventory: JSON.stringify(distractionsInventory)
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
        distractionsInventory: '{}'
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
        'hayden': 25
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
