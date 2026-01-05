const session = require('express-session');
const jwt = require('jsonwebtoken');
const db = require('../util/database');


const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
});

function isAuthenticated(req, res, next) {
  if (req.session.user) {
    const tokenData = req.session.token;

    try {
      // Check if the token has expired
      const currentTime = Math.floor(Date.now() / 1000);
      if (tokenData.exp < currentTime) {
        throw new Error('Token has expired');
      }
      next();
    } catch (err) {
      console.log('Authentication error:', err.message);
      req.session.destroy();
      res.redirect('/login');
    }
  } else {
    console.log('User not authenticated, redirecting to login');
    console.log(`Redirect URL: ${process.env.AUTH_URL}?redirectURL=${process.env.THIS_URL}`);
    res.redirect('/login');
  }
}

function handleLogin(req, res) {
  if (req.query.token) {
    const rawToken = req.query.token;
    const tokenData = jwt.decode(rawToken);

    req.session.token = tokenData;
    req.session.user = tokenData.displayName;
    req.session.permission = tokenData.permissions;
    
    // Helper function to load user payment status and redirect
    const loadPaymentStatusAndRedirect = () => {
      db.get("SELECT hasPaid FROM users WHERE id = ?", [tokenData.id], (err, row) => {
        if (err) {
          console.error('Error loading payment status:', err.message);
        } else if (row) {
          req.session.hasPaid = !!row.hasPaid;
          console.log(`Loaded payment status for user ${tokenData.id}: hasPaid=${req.session.hasPaid}`);
        }
        
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('Session save error:', saveErr);
          }
          const redirectTo = req.query.redirectURL || '/';
          res.redirect(redirectTo);
        });
      });
    };
    
    db.run("INSERT INTO users (id, displayName, pin) VALUES (?, ?, ?)", [tokenData.id, tokenData.displayName, null], (err) => {
      // if the table doesnt exist, create it
      if (err && err.message.includes('no such table')) {
        db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, displayName TEXT, pin INTERGER)", (err) => {
          if (err) {
            console.error('Error creating users table:', err.message);
          } else {
            // try inserting again
            db.run("INSERT INTO users (id, displayName, pin) VALUES (?, ?, ?)", [tokenData.id, tokenData.displayName, null], (err) => {
              if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                  // User already exists, load their payment status
                  loadPaymentStatusAndRedirect();
                } else {
                  console.error('Database error:', err.message);
                  const redirectTo = req.query.redirectURL || '/';
                  res.redirect(redirectTo);
                }
              } else {
                console.log('New user added to database');
                loadPaymentStatusAndRedirect();
              }
            });
          }
        });
      } else if (err && err.message.includes('UNIQUE constraint failed')) {
        // User already exists, load their payment status
        loadPaymentStatusAndRedirect();
      } else if (err) {
        console.error('Database error:', err.message);
        res.status(500).send('Database error');
      } else {
        console.log('New user added to database');
        loadPaymentStatusAndRedirect();
      }
    });
  } else {
    res.redirect(`${process.env.AUTH_URL}?redirectURL=${process.env.THIS_URL}`);
  }
}

module.exports = {
  sessionMiddleware,
  isAuthenticated,
  handleLogin
};
