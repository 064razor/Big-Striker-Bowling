const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { registerSockets } = require('./sockets');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

registerSockets(io);

server.listen(PORT, () => {
  console.log(`Big Striker Bowling online server running at http://localhost:${PORT}`);
});
