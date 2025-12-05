const express = require('express');
const { isAuthenticated, handleLogin } = require('./middleware');
const { games } = require('./game');

function setupRoutes(app) {
  app.get('/login', handleLogin);

  app.get('/', isAuthenticated, (req, res) => {
    res.render('index.ejs', { user: req.session.user });
  });

  app.get('/game', isAuthenticated, (req, res) => {
    res.render('game.ejs', { user: req.session.user, gameId: req.query.gameId || 'default' });
  });

  app.get('/lobby', isAuthenticated, (req, res) => {
    res.render('lobby.ejs', { user: req.session.user });
  });

  app.get('/room/:gameId', isAuthenticated, (req, res) => {
    const game = games[req.params.gameId];
    const lobbyName = (game && game.lobbyName) ? game.lobbyName : (req.query.lobbyName || '');
    res.render('room.ejs', { user: req.session.user, gameId: req.params.gameId, lobbyName });
  });

  app.get('/about', (req, res) => {
    res.render('about.ejs', { user: req.session.user });
  });

  app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
  });
}

module.exports = { setupRoutes };
