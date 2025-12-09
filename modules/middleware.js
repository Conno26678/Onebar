const session = require('express-session');
const jwt = require('jsonwebtoken');
const config = require('./config');

const sessionMiddleware = session({
  secret: config.SESSION_SECRET,
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

    const redirectTo = req.query.redirectURL || '/';
    res.redirect(redirectTo);
    console.log(`User ${tokenData.displayName} logged in`);
  } else {
    const redirectURL = encodeURIComponent(`${config.THIS_URL}/login`);
    res.redirect(`${config.AUTH_URL}/oauth?redirectURL=${redirectURL}`);
    console.log('Redirecting to auth server');
  }
}

module.exports = {
  sessionMiddleware,
  isAuthenticated,
  handleLogin
};
