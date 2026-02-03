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

/**
 * Calculate XP required for a given level
 * Progressive system: Each level requires more XP than the last
 * Formula: baseXP * level^1.5, rounded to nearest 50
 * @param {number} level - The level to calculate XP for
 * @returns {number} XP required to reach that level
 */
function calculateXPForLevel(level) {
    const baseXP = 100;
    const rawXP = baseXP * Math.pow(level, 1.5);
    // Round to nearest 50 for cleaner numbers (100, 150, 200, 250, 300, etc.)
    return Math.round(rawXP / 50) * 50;
}

/**
 * Add XP to a user and handle level ups
 * @param {number} userId - The user's ID
 * @param {number} xpToAdd - Amount of XP to add
 * @param {function} callback - Callback function (err, result)
 */
function addXP(userId, xpToAdd, callback) {
    db.get('SELECT xp, level FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return callback(err || new Error('User not found'), null);
        }
        
        let currentXP = user.xp + xpToAdd;
        let currentLevel = user.level;
        let levelsGained = 0;
        
        // Check for level ups
        while (true) {
            const xpNeeded = calculateXPForLevel(currentLevel + 1);
            if (currentXP >= xpNeeded) {
                currentXP -= xpNeeded;
                currentLevel++;
                levelsGained++;
            } else {
                break;
            }
        }
        
        // Update the database
        db.run(
            'UPDATE users SET xp = ?, level = ? WHERE id = ?',
            [currentXP, currentLevel, userId],
            (updateErr) => {
                if (updateErr) {
                    return callback(updateErr, null);
                }
                callback(null, {
                    xp: currentXP,
                    level: currentLevel,
                    levelsGained,
                    xpAdded: xpToAdd,
                    xpForNextLevel: calculateXPForLevel(currentLevel + 1)
                });
            }
        );
    });
}

module.exports = db;
module.exports.calculateXPForLevel = calculateXPForLevel;
module.exports.addXP = addXP;