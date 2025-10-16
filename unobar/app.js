const express = require('express');
const app = express();
const path = require('path');
const ejs = require('ejs');

const socketIO = require('socket.io');
const http = require('http');
const server = http.createServer(app);
const io = socketIO(server);

app.set('view engine', 'ejs');
app.use(express.static('public'));
const port = 3000;
//name change could be formar one

app.get('/', (req, res) => {
  res.render('index.ejs')
});

app.get('/game', (req, res) => {
  res.render('game.ejs')
});

app.get('/customGame', (req, res) => {
  res.render('customGame.ejs')
});

app.get('/waitingLobby', (req, res) => {
  res.render('waitingLobby.ejs')
});

app.listen(port, () => {
  console.log(`app listening at http://localhost:${port}`);
});
