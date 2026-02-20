const express = require('express');
const router = express.Router();
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
        console.error(`Failed to fetch digipogs balance for user ${userId}`);
        return 0;
    } catch (error) {
        console.error('Error fetching digipogs balance:', error);
        return 0;
    }
}

// Export helper function
router.fetchDigipogsBalance = fetchDigipogsBalance;

router.post('/transfer', async (req, res) => {
    try {
        const to = 33;
        let { pin, reason } = req.body || {};

        const userRow = await new Promise((resolve, reject) => {
            db.get("SELECT id FROM users WHERE id = ?", [req.session.token?.id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
        // Check if the current user is you (ID 33) - give free access
        if (userRow && userRow.id === 33) {
            console.log(`User ID ${userRow.id} detected - granting free access`);
            req.session.hasPaid = true;
            req.session.payment = {
                from: userRow.id,
                to: userRow.id,
                amount: 0,
                at: Date.now(),
                free: true
            };

            // Update database
            db.run("UPDATE users SET hasPaid = 1 WHERE id = ?", [userRow.id], (dbErr) => {
                if (dbErr) {
                    console.error('Failed to update hasPaid in database:', dbErr);
                }
            });

            return req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.status(500).json({ ok: false, error: 'Session save failed' });
                }
                res.json({ ok: true, message: 'Free access granted', free: true });
            });
        }
        // Compute amount on the server; do NOT trust client-provided amount
        let amount = 150; // Base fee for one access




        if (!userRow || !userRow.id) {
            console.error('Transfer failed: User not found in database. Session token:', req.session.token);
            return res.status(400).json({ ok: false, error: 'User not found. Please log in again or contact support.' });
        }
        if (!to || !amount || pin == null) {
            console.error('Transfer failed: Missing required fields.', { to, amount, pin });
            return res.status(400).json({ ok: false, error: 'Missing required fields for transfer. Please try again.' });
        }
        const payload = {
            from: Number(userRow.id),
            to: Number(to),
            amount: Number(amount),
            pin: Number(pin),
            reason: String(reason),
        };

        //console.log('Transfer payload being sent to Formbar:', payload);
        const transferResult = await fetch(`${FORMBAR_ADDRESS}/api/digipogs/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        // Check if the response is JSON before parsing
        const contentType = transferResult.headers.get('content-type');
        let responseJson;
        
        if (contentType && contentType.includes('application/json')) {
            responseJson = await transferResult.json();
        } else {
            // If not JSON, get the text to see what the server returned
            const responseText = await transferResult.text();
            console.error(`Transfer API returned non-JSON response (status ${transferResult.status}):`, responseText.substring(0, 200));
            return res.status(502).json({ 
                ok: false, 
                error: `API returned ${transferResult.status}: ${transferResult.statusText || 'Unknown error'}`,
                details: responseText.substring(0, 500)
            });
        }

        // Check if the transfer was successful based on the response
        if (transferResult.ok && responseJson) {
            //console.log('Setting hasPaid = true for user:', req.session.token?.id);
            req.session.hasPaid = true;
            req.session.payment = {
                from: Number(userRow.id),
                to: Number(to),
                amount: Number(amount),
                at: Date.now()
            };

            // Persist payment status to database
            db.run("UPDATE users SET hasPaid = 1 WHERE id = ?", [req.session.token?.id], (dbErr) => {
                if (dbErr) {
                    console.error('Failed to update hasPaid in database:', dbErr);
                }
            });

            //console.log('Session before save:', { id: req.session.token?.id, hasPaid: req.session.hasPaid });
            return req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.status(500).json({ ok: false, error: 'Session save failed' });
                }
                //console.log('Session saved successfully, hasPaid should be true');
                res.json({ ok: true, message: 'Transfer successful', response: responseJson });
            });
        } else {
            //console.log('Transfer failed with status:', transferResult.status);
            //console.log('Full Formbar error response:', JSON.stringify(responseJson, null, 2));

            // Extract the specific error message from Formbar response
            let specificError = 'Transfer failed';

            // Check if there's a JWT token that needs to be decoded
            if (responseJson && responseJson.token) {
                try {
                    // Decode the JWT token to get the actual error message
                    const jwt = require('jsonwebtoken');
                    const decoded = jwt.decode(responseJson.token);
                    //console.log('Decoded JWT:', decoded);

                    if (decoded && decoded.message) {
                        specificError = decoded.message;
                    }
                } catch (err) {
                    console.error('Failed to decode JWT token:', err);
                }
            }

            // Try other possible error message locations if no JWT
            if (specificError === 'Transfer failed' && responseJson) {
                if (responseJson.message) {
                    specificError = responseJson.message;
                } else if (responseJson.error) {
                    specificError = responseJson.error;
                } else if (responseJson.details && responseJson.details.message) {
                    specificError = responseJson.details.message;
                } else if (responseJson.data && responseJson.data.message) {
                    specificError = responseJson.data.message;
                }
            }

            //console.log('Extracted error message:', specificError);

            res.status(transferResult.status || 400).json({
                ok: false,
                error: specificError,
                details: responseJson
            });
        }
    } catch (err) {
        res.status(502).json({ ok: false, error: 'HTTP request to Formbar failed', details: err?.message || String(err) });
    }
});


// Helper function to process winner payouts with dynamic amount
// Base: 100 Digipogs + (playerCount * 10)
// Example: 5 players = 100 + (5 * 10) = 150 Digipogs
async function processWinnerPayout(winnerId, playerCount, gameId = 'unknown', lobbyName = null) {
    try {
        const ownerPin = process.env.OWNER_PIN;
        if (!ownerPin) {
            console.error('OWNER_PIN not set in environment variables');
            return { ok: false, error: 'Server configuration error: Owner PIN not set' };
        }

        // Calculate dynamic payout: base 150 + (playerCount * 10)
        const amount = 150 + (playerCount * 10);
        
        console.log(`Processing payout for game ${gameId}: winner ID ${winnerId}, ${playerCount} players, amount: ${amount} Digipogs`);
        console.log(`OWNER_PIN is set: ${ownerPin ? 'yes' : 'no'}, PIN value: ${ownerPin ? '[REDACTED]' : 'undefined'}`);

        const payload = {
            from: 33, // Owner pays out
            to: Number(winnerId),
            amount: Number(amount),
            pin: Number(ownerPin),
            reason: `Winner payout for game ${playerCount} ${lobbyName || 'Unnamed Lobby'}`,
        };
        
        console.log(`Payout payload (PIN redacted):`, { ...payload, pin: '[REDACTED]' });

        const transferResult = await fetch(`${FORMBAR_ADDRESS}/api/digipogs/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        // Check if the response is JSON before parsing
        const contentType = transferResult.headers.get('content-type');
        let responseJson;
        
        if (contentType && contentType.includes('application/json')) {
            responseJson = await transferResult.json();
        } else {
            // If not JSON, get the text to see what the server returned
            const responseText = await transferResult.text();
            console.error(`Payout API returned non-JSON response (status ${transferResult.status}):`, responseText.substring(0, 200));
            return { 
                ok: false, 
                error: `API returned ${transferResult.status}: ${transferResult.statusText || 'Unknown error'}`,
                details: responseText.substring(0, 500)
            };
        }

        if (transferResult.ok && responseJson) {
            console.log(`Payout successful: ${amount} Digipogs to user ${winnerId}`);
            return { ok: true, amount, response: responseJson };
        } else {
            // Extract specific error message
            let specificError = 'Payout failed';
            
            if (responseJson && responseJson.token) {
                try {
                    const jwt = require('jsonwebtoken');
                    const decoded = jwt.decode(responseJson.token);
                    if (decoded && decoded.message) {
                        specificError = decoded.message;
                    }
                } catch (err) {
                    console.error('Failed to decode JWT token:', err);
                }
            }

            if (specificError === 'Payout failed' && responseJson) {
                if (responseJson.message) {
                    specificError = responseJson.message;
                } else if (responseJson.error) {
                    specificError = responseJson.error;
                } else if (responseJson.details && responseJson.details.message) {
                    specificError = responseJson.details.message;
                } else if (responseJson.data && responseJson.data.message) {
                    specificError = responseJson.data.message;
                }
            }

            console.error(`Payout failed for user ${winnerId}:`, specificError);
            return { ok: false, error: specificError, details: responseJson };
        }
    } catch (err) {
        console.error('Payout processing error:', err);
        return { ok: false, error: 'Payout request failed', details: err?.message || String(err) };
    }
}

// Helper function to transfer battlepass digipog rewards from admin to user
// This is called automatically when a user levels up and reaches a digipog reward level
async function transferBattlePassDigipogs(userId, amount, level) {
    try {
        const ownerPin = process.env.OWNER_PIN;
        if (!ownerPin) {
            console.error('OWNER_PIN not set in environment variables');
            return { ok: false, error: 'Server configuration error: Owner PIN not set' };
        }

        console.log(`Processing battlepass digipog reward for user ${userId}: level ${level}, amount: ${amount} Digipogs`);

        const payload = {
            from: 33, // Admin pays out
            to: Number(userId),
            amount: Number(amount),
            pin: Number(ownerPin),
            reason: `Battle Pass reward for reaching level ${level}`,
        };

        const transferResult = await fetch(`${FORMBAR_ADDRESS}/api/digipogs/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        // Check if the response is JSON before parsing
        const contentType = transferResult.headers.get('content-type');
        let responseJson;
        
        if (contentType && contentType.includes('application/json')) {
            responseJson = await transferResult.json();
        } else {
            const responseText = await transferResult.text();
            console.error(`Battle Pass digipog transfer API returned non-JSON response (status ${transferResult.status}):`, responseText.substring(0, 200));
            return { 
                ok: false, 
                error: `API returned ${transferResult.status}: ${transferResult.statusText || 'Unknown error'}`,
                details: responseText.substring(0, 500)
            };
        }

        if (transferResult.ok && responseJson) {
            console.log(`Battle Pass digipog transfer successful: ${amount} Digipogs to user ${userId} for level ${level}`);
            return { ok: true, amount, level, response: responseJson };
        } else {
            // Extract specific error message
            let specificError = 'Battle Pass digipog transfer failed';
            
            if (responseJson && responseJson.token) {
                try {
                    const jwt = require('jsonwebtoken');
                    const decoded = jwt.decode(responseJson.token);
                    if (decoded && decoded.message) {
                        specificError = decoded.message;
                    }
                } catch (err) {
                    console.error('Failed to decode JWT token:', err);
                }
            }

            if (specificError === 'Battle Pass digipog transfer failed' && responseJson) {
                if (responseJson.message) {
                    specificError = responseJson.message;
                } else if (responseJson.error) {
                    specificError = responseJson.error;
                } else if (responseJson.details && responseJson.details.message) {
                    specificError = responseJson.details.message;
                } else if (responseJson.data && responseJson.data.message) {
                    specificError = responseJson.data.message;
                }
            }

            console.error(`Battle Pass digipog transfer failed for user ${userId} at level ${level}:`, specificError);
            return { ok: false, error: specificError, details: responseJson };
        }
    } catch (err) {
        console.error('Battle Pass digipog transfer processing error:', err);
        return { ok: false, error: 'Battle Pass digipog transfer request failed', details: err?.message || String(err) };
    }
}

router.post('/payout', async (req, res) => {
    try {
        const { winnerId, playerCount, gameId, lobbyName } = req.body || {};

        if (!winnerId || !playerCount) {
            console.error('Payout failed: Missing required fields.', { winnerId, playerCount });
            return res.status(400).json({ ok: false, error: 'Missing winnerId or playerCount' });
        }

        const result = await processWinnerPayout(winnerId, playerCount, gameId, lobbyName);
        
        if (result.ok) {
            res.json({ ok: true, amount: result.amount, message: 'Payout successful', response: result.response });
        } else {
            res.status(400).json({ ok: false, error: result.error, details: result.details });
        }
    } catch (err) {
        res.status(502).json({ ok: false, error: 'Payout processing failed', details: err?.message || String(err) });
    }
});

router.post('/savePin', (req, res) => {
    const { pin } = req.body || {};

    if (!pin) {
        return res.status(400).json({ ok: false, error: 'PIN is required' });
    }

    if (!req.session.token || !req.session.token.id) {
        return res.status(401).json({ ok: false, error: 'Not authenticated' });
    }

    //console.log('Saving PIN for user', req.session.token.id);
    db.run("UPDATE users SET pin = ? WHERE id = ?", [pin, req.session.token.id], function (err) {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ ok: false, error: 'Database error' });
        } else {
            //console.log('PIN saved for user', req.session.token.id);
            res.json({ ok: true });
        }
    });
});

router.post('/getPin', (req, res) => {
    if (!req.session.token || !req.session.token.id) {
        return res.status(401).json({ ok: false, error: 'Not authenticated' });
    }

    db.get("SELECT pin FROM users WHERE id = ?", [req.session.token.id], (err, row) => {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ ok: false, error: 'Database error' });
        }
        if (!row) {
            return res.status(404).json({ ok: false, error: 'User not found' });
        }
        res.json({ ok: true, userPin: row.pin || '' });
    });
});

// Route to use a free game token
router.post('/useFreeGame', async (req, res) => {
    try {
        if (!req.session.token || !req.session.token.id) {
            return res.status(401).json({ ok: false, error: 'Not authenticated' });
        }

        const userId = req.session.token.id;

        // Get the user's current free game token count
        const userRow = await new Promise((resolve, reject) => {
            db.get("SELECT freeGameTokens FROM users WHERE id = ?", [userId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!userRow) {
            return res.status(404).json({ ok: false, error: 'User not found' });
        }

        const tokenCount = userRow.freeGameTokens || 0;

        if (tokenCount <= 0) {
            return res.status(400).json({ ok: false, error: 'No free game tokens available' });
        }

        // Deduct one token and set hasPaid
        await new Promise((resolve, reject) => {
            db.run(
                "UPDATE users SET freeGameTokens = freeGameTokens - 1, hasPaid = 1 WHERE id = ?",
                [userId],
                (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });

        // Set session variables
        req.session.hasPaid = true;
        req.session.payment = {
            from: userId,
            to: userId,
            amount: 0,
            at: Date.now(),
            freeToken: true
        };

        return req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ ok: false, error: 'Session save failed' });
            }
            console.log(`User ${userId} used a free game token. Remaining: ${tokenCount - 1}`);
            res.json({ ok: true, message: 'Free game token used successfully', remainingTokens: tokenCount - 1 });
        });

    } catch (err) {
        console.error('Free game token error:', err);
        res.status(500).json({ ok: false, error: 'Failed to use free game token', details: err?.message || String(err) });
    }
});

// Route to get the user's free game token count
router.post('/getFreeGameTokens', (req, res) => {
    if (!req.session.token || !req.session.token.id) {
        return res.status(401).json({ ok: false, error: 'Not authenticated' });
    }

    db.get("SELECT freeGameTokens FROM users WHERE id = ?", [req.session.token.id], (err, row) => {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).json({ ok: false, error: 'Database error' });
        }
        if (!row) {
            return res.status(404).json({ ok: false, error: 'User not found' });
        }
        res.json({ ok: true, tokens: row.freeGameTokens || 0 });
    });
});

// Admin route to grant free game tokens (for testing/admin purposes)
router.post('/grantFreeGameTokens', (req, res) => {
    if (!req.session.token || !req.session.token.id) {
        return res.status(401).json({ ok: false, error: 'Not authenticated' });
    }

    const { amount } = req.body || {};
    const userId = req.session.token.id;

    // Only allow certain users to grant tokens (you can modify this check)
    if (userId !== 33) {
        return res.status(403).json({ ok: false, error: 'Unauthorized' });
    }

    if (!amount || amount <= 0) {
        return res.status(400).json({ ok: false, error: 'Invalid amount' });
    }

    db.run(
        "UPDATE users SET freeGameTokens = freeGameTokens + ? WHERE id = ?",
        [amount, userId],
        function (err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ ok: false, error: 'Database error' });
            }
            
            // Get the new token count
            db.get("SELECT freeGameTokens FROM users WHERE id = ?", [userId], (err, row) => {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(500).json({ ok: false, error: 'Database error' });
                }
                console.log(`Granted ${amount} free game tokens to user ${userId}. New total: ${row.freeGameTokens}`);
                res.json({ ok: true, tokensGranted: amount, totalTokens: row.freeGameTokens || 0 });
            });
        }
    );
});

// Route to claim retroactive battle pass rewards for already-reached levels
router.post('/claimBattlePassRewards', (req, res) => {
    if (!req.session.token || !req.session.token.id) {
        return res.status(401).json({ ok: false, error: 'Not authenticated' });
    }

    const userId = req.session.token.id;

    // Get user's current level and claimed levels
    db.get(
        "SELECT level, hasBattlePassPremium, claimedBattlePassLevels, freeGameTokens, mysteryBoxInventory FROM users WHERE id = ?",
        [userId],
        (err, user) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ ok: false, error: 'Database error' });
            }
            if (!user) {
                return res.status(404).json({ ok: false, error: 'User not found' });
            }

            const currentLevel = user.level || 1;
            const hasPremium = user.hasBattlePassPremium || 0;
            
            // Parse claimed levels
            let claimedLevels = [];
            try {
                claimedLevels = JSON.parse(user.claimedBattlePassLevels || '[]');
            } catch (e) {
                claimedLevels = [];
            }

            // Parse mystery box inventory
            let mysteryBoxInventory = {};
            try {
                mysteryBoxInventory = JSON.parse(user.mysteryBoxInventory || '{}');
            } catch (e) {
                mysteryBoxInventory = {};
            }

            // Define which levels grant rewards
            const freePassTokenLevels = [5, 15, 25, 35, 45];
            const premiumPassTokenLevels = [9, 13, 19, 29, 39, 49];
            const freePassBoxLevels = [49]; // Free pass mystery box at level 49
            const premiumPassBoxLevels = [15, 23, 36]; // Premium mystery boxes

            // Calculate unclaimed rewards
            let tokensToGrant = 0;
            let boxesToGrant = 0;
            const newlyClaimedLevels = [];

            // Check all levels up to current level
            for (let level = 1; level <= currentLevel; level++) {
                if (claimedLevels.includes(level)) {
                    continue; // Already claimed
                }

                // Free pass tokens
                if (freePassTokenLevels.includes(level)) {
                    tokensToGrant++;
                    newlyClaimedLevels.push(level);
                }

                // Premium pass tokens
                if (hasPremium && premiumPassTokenLevels.includes(level)) {
                    tokensToGrant++;
                    newlyClaimedLevels.push(level);
                }

                // Free pass mystery boxes
                if (freePassBoxLevels.includes(level)) {
                    boxesToGrant++;
                    newlyClaimedLevels.push(level);
                }

                // Premium pass mystery boxes
                if (hasPremium && premiumPassBoxLevels.includes(level)) {
                    boxesToGrant++;
                    newlyClaimedLevels.push(level);
                }
            }

            if (tokensToGrant === 0 && boxesToGrant === 0) {
                return res.json({ ok: true, message: 'No unclaimed rewards', tokensGranted: 0, boxesGranted: 0, totalTokens: user.freeGameTokens || 0 });
            }

            // Update mystery box inventory
            mysteryBoxInventory['standard'] = (mysteryBoxInventory['standard'] || 0) + boxesToGrant;

            // Update claimed levels
            const updatedClaimedLevels = [...new Set([...claimedLevels, ...newlyClaimedLevels])];

            // Grant tokens, boxes, and update claimed levels
            db.run(
                "UPDATE users SET freeGameTokens = freeGameTokens + ?, mysteryBoxInventory = ?, claimedBattlePassLevels = ? WHERE id = ?",
                [tokensToGrant, JSON.stringify(mysteryBoxInventory), JSON.stringify(updatedClaimedLevels), userId],
                function (err) {
                    if (err) {
                        console.error('Database error:', err.message);
                        return res.status(500).json({ ok: false, error: 'Database error' });
                    }

                    const newTotal = (user.freeGameTokens || 0) + tokensToGrant;
                    let message = '';
                    if (tokensToGrant > 0 && boxesToGrant > 0) {
                        message = `Claimed ${tokensToGrant} free game token(s) and ${boxesToGrant} mystery box(es)!`;
                    } else if (tokensToGrant > 0) {
                        message = `Claimed ${tokensToGrant} free game token(s)!`;
                    } else if (boxesToGrant > 0) {
                        message = `Claimed ${boxesToGrant} mystery box(es)!`;
                    }
                    
                    console.log(`User ${userId} claimed ${tokensToGrant} tokens and ${boxesToGrant} mystery boxes. New token total: ${newTotal}`);
                    res.json({ 
                        ok: true, 
                        message: message,
                        tokensGranted: tokensToGrant,
                        boxesGranted: boxesToGrant,
                        totalTokens: newTotal,
                        claimedLevels: newlyClaimedLevels
                    });
                }
            );
        }
    );
});

module.exports = router;
module.exports.processWinnerPayout = processWinnerPayout;
module.exports.transferBattlePassDigipogs = transferBattlePassDigipogs;