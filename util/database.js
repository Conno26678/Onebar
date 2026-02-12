const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const folderPath = 'data';

const db = new sqlite3.Database('data/database.db', (err) => {
    if (err) {
        console.error('Database connection error:', err);
        if (err.code === 'SQLITE_CANTOPEN') {
            fs.mkdirSync(folderPath, { recursive: true });
            //console.log(`Created folder: ${folderPath}`);
            const db = new sqlite3.Database('data/database.db');
            return db;
        }
    } else {
        console.log("Connected to database");
    }
});


db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    displayName TEXT,
    pin INTEGER,
    hasPaid INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    gamesPlayed INTEGER DEFAULT 0
);`);

// Add hasPaid column if it doesn't exist (for existing databases)
db.run(`ALTER TABLE users ADD COLUMN hasPaid INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding hasPaid column:', err.message);
    }
});

// Add wins column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN wins INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding wins column:', err.message);
    }
});

// Add losses column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN losses INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding losses column:', err.message);
    }
});

// Add gamesPlayed column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN gamesPlayed INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding gamesPlayed column:', err.message);
    }
});

// Add xp column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding xp column:', err.message);
    }
});

// Add level column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding level column:', err.message);
    }
});

// Add hasBattlePassPremium column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN hasBattlePassPremium INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding hasBattlePassPremium column:', err.message);
    }
});

// Add profilePicture column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN profilePicture TEXT DEFAULT '/img/pfp.png'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding profilePicture column:', err.message);
    }
});

// Add selectedTitle column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN selectedTitle TEXT DEFAULT 'Newbie'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding selectedTitle column:', err.message);
    }
});

// Add selectedTheme column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN selectedTheme TEXT DEFAULT 'default'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding selectedTheme column:', err.message);
    }
});

// Add selectedSoundPack column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN selectedSoundPack TEXT DEFAULT 'default'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding selectedSoundPack column:', err.message);
    }
});

// Add selectedBadge column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN selectedBadge TEXT DEFAULT 'none'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding selectedBadge column:', err.message);
    }
});

// Add selectedEmote column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN selectedEmote TEXT DEFAULT 'wave'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding selectedEmote column:', err.message);
    }
});

// Add selectedEmotes column (stores 4 emojis as JSON array) if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN selectedEmotes TEXT DEFAULT '["wave","thumbsup","party","fire"]'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding selectedEmotes column:', err.message);
    }
});

// Add selectedTitleColor column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN selectedTitleColor TEXT DEFAULT 'white'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding selectedTitleColor column:', err.message);
    }
});

// Add selectedEffect column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN selectedEffect TEXT DEFAULT 'confetti'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding selectedEffect column:', err.message);
    }
});

// Add freeGameTokens column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN freeGameTokens INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding freeGameTokens column:', err.message);
    }
});

// Add onecells column if it doesn't exist
db.run(`ALTER TABLE users ADD COLUMN onecells INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding onecells column:', err.message);
    }
});

// Add purchasedThemes column if it doesn't exist (stores JSON array of purchased theme names)
db.run(`ALTER TABLE users ADD COLUMN purchasedThemes TEXT DEFAULT '[]'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding purchasedThemes column:', err.message);
    }
});

// Add distractionsInventory column if it doesn't exist (stores JSON object of distraction counts)
db.run(`ALTER TABLE users ADD COLUMN distractionsInventory TEXT DEFAULT '{}'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding distractionsInventory column:', err.message);
    }
});

// Add mysteryBoxInventory column if it doesn't exist (stores JSON object of mystery box counts)
db.run(`ALTER TABLE users ADD COLUMN mysteryBoxInventory TEXT DEFAULT '{}'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding mysteryBoxInventory column:', err.message);
    }
});

// Add customSounds column if it doesn't exist (stores JSON object of custom sound preferences)
db.run(`ALTER TABLE users ADD COLUMN customSounds TEXT DEFAULT '{}'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding customSounds column:', err.message);
    }
});

// Add claimedBattlePassLevels column to track which levels have been claimed (stores JSON array)
db.run(`ALTER TABLE users ADD COLUMN claimedBattlePassLevels TEXT DEFAULT '[]'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding claimedBattlePassLevels column:', err.message);
    }
});

/**
 * Calculate XP required for a given level
 * Progressive system: More gradual scaling for motivation
 * Formula: 50 + (level * 35) + (level^1.2 * 5), rounded to nearest 50
 * Level 10: ~500 XP, Level 20: ~950 XP, Level 50: ~2450 XP
 * @param {number} level - The level to calculate XP for
 * @returns {number} XP required to reach that level
 */
function calculateXPForLevel(level) {
    // More gradual scaling: starts at ~100 XP, reaches ~2500 XP at level 50
    const rawXP = 50 + (level * 35) + (Math.pow(level, 1.2) * 5);
    // Round to nearest 50 for cleaner numbers
    return Math.round(rawXP / 50) * 50;
}

/**
 * Add XP to a user and handle level ups
 * @param {number} userId - The user's ID
 * @param {number} xpToAdd - Amount of XP to add
 * @param {function} callback - Callback function (err, result)
 */
function addXP(userId, xpToAdd, callback) {
    db.get('SELECT xp, level, hasBattlePassPremium, claimedBattlePassLevels FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return callback(err || new Error('User not found'), null);
        }
        
        let currentXP = user.xp + xpToAdd;
        let currentLevel = user.level;
        let levelsGained = 0;
        let levelsReached = [];
        
        // Check for level ups
        while (true) {
            const xpNeeded = calculateXPForLevel(currentLevel + 1);
            if (currentXP >= xpNeeded) {
                currentXP -= xpNeeded;
                currentLevel++;
                levelsGained++;
                levelsReached.push(currentLevel);
            } else {
                break;
            }
        }
        
        // Define which levels grant free game tokens
        const freePassTokenLevels = [5, 15, 25, 35, 45];
        const premiumPassTokenLevels = [9, 13, 19, 29, 39, 49];
        
        // Get already claimed levels
        let claimedLevels = [];
        try {
            claimedLevels = JSON.parse(user.claimedBattlePassLevels || '[]');
        } catch (e) {
            claimedLevels = [];
        }
        
        // Calculate how many tokens to grant
        let tokensToGrant = 0;
        levelsReached.forEach(level => {
            // Skip if already claimed
            if (claimedLevels.includes(level)) {
                return;
            }
            
            // Free pass tokens (available to all)
            if (freePassTokenLevels.includes(level)) {
                tokensToGrant++;
                claimedLevels.push(level);
            }
            // Premium pass tokens (only if user has premium)
            if (user.hasBattlePassPremium && premiumPassTokenLevels.includes(level)) {
                tokensToGrant++;
                claimedLevels.push(level);
            }
        });
        
        // Update the database
        let updateQuery = 'UPDATE users SET xp = ?, level = ?, claimedBattlePassLevels = ? WHERE id = ?';
        let updateParams = [currentXP, currentLevel, JSON.stringify(claimedLevels), userId];
        
        // If tokens should be granted, add to update query
        if (tokensToGrant > 0) {
            updateQuery = 'UPDATE users SET xp = ?, level = ?, freeGameTokens = freeGameTokens + ?, claimedBattlePassLevels = ? WHERE id = ?';
            updateParams = [currentXP, currentLevel, tokensToGrant, JSON.stringify(claimedLevels), userId];
        }
        
        db.run(updateQuery, updateParams, (updateErr) => {
            if (updateErr) {
                return callback(updateErr, null);
            }
            callback(null, {
                xp: currentXP,
                level: currentLevel,
                levelsGained,
                xpAdded: xpToAdd,
                xpForNextLevel: calculateXPForLevel(currentLevel + 1),
                freeGameTokensGranted: tokensToGrant
            });
        });
    });
}

module.exports = db;
module.exports.calculateXPForLevel = calculateXPForLevel;
module.exports.addXP = addXP;