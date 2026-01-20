const express = require('express');
const router = express.Router();
const db = require('../util/database');
const FORMBAR_ADDRESS = process.env.FORMBAR_ADDRESS || 'https://formbeta.yorktechapps.com';

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
            console.log('Owner (ID 33) detected - granting free access');
            req.session.hasPaid = true;
            req.session.payment = {
                from: 33,
                to: 33,
                amount: 0,
                at: Date.now(),
                free: true
            };

            // Update database
            db.run("UPDATE users SET hasPaid = 1 WHERE id = ?", [33], (dbErr) => {
                if (dbErr) {
                    console.error('Failed to update hasPaid in database:', dbErr);
                }
            });

            return req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.status(500).json({ ok: false, error: 'Session save failed' });
                }
                res.json({ ok: true, message: 'Free access granted for owner', free: true });
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

        // Calculate dynamic payout: base 100 + (playerCount * 10)
        const amount = 100 + (playerCount * 10);
        
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

module.exports = router;
module.exports.processWinnerPayout = processWinnerPayout;