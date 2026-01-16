const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.db');

db.all('SELECT id, displayName, xp, level FROM users ORDER BY id', [], (err, rows) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('Users in database:');
    console.table(rows);
  }
  db.close();
});
