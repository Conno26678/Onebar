// Imports
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

// Modules
const config = require('./modules/config');
const { sessionMiddleware } = require('./modules/middleware');
const { setupRoutes } = require('./modules/routes');
const { setupSocketHandlers } = require('./modules/socket-handlers');

// App setup
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(sessionMiddleware);

// Attach session middleware to socket.io so we can read session in sockets
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Setup routes
setupRoutes(app);

// Setup socket handlers
setupSocketHandlers(io);

// Start the server silly
server.listen(config.port, () => {
  console.log(`app listening at http://localhost:${config.port}`);
});