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
    hasPaid INTEGER DEFAULT 0
);`);

// Add hasPaid column if it doesn't exist (for existing databases)
db.run(`ALTER TABLE users ADD COLUMN hasPaid INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding hasPaid column:', err.message);
    }
});

module.exports = db;