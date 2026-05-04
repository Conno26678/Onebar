// Imports
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const db = require('./util/database');
const dotenv = require('dotenv')

dotenv.config({ quiet: true });

// Modules
const { sessionMiddleware, addThemeToLocals } = require('./modules/middleware');
const { setupRoutes } = require('./modules/routes');
const { setupSocketHandlers } = require('./modules/socket-handlers');

// App setup
const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const port = Number(process.env.PORT) || 3000;

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(sessionMiddleware);
app.use(addThemeToLocals);

// Favicon handler
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Attach session middleware to socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Make io available to routes
app.set('io', io);

// Reset hasPaid status on server startup (except for owner ID 33)
db.run("UPDATE users SET hasPaid = 0 WHERE id != 33", (err) => {
  if (err) {
    console.error('Error resetting hasPaid status on startup:', err.message);
  } else {
    console.log('Reset hasPaid status for all users except owner (ID 33)');
  }
});

// Setup routes
setupRoutes(app);

// Setup socket handlers
setupSocketHandlers(io);

// Start the server
server.listen(port, () => {
  console.log(`app listening at http://localhost:${port}`);
});

