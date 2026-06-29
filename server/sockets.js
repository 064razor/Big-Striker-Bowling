const { rooms, uniqueRoomCode, publicRoom, broadcastRoom, findPlayerRoom, cleanName } = require('./rooms');
const { countGameWinner } = require('./scoring');

function makePlayer(socket, index, data = {}) {
  const colorIndex = Number(data.colorIndex);
  return {
    id: socket.id,
    clientId: String(data.clientId || socket.id),
    name: cleanName(data.name, `Player ${index + 1}`),
    colorIndex: Number.isInteger(colorIndex) ? Math.max(0, Math.min(9, colorIndex)) : 0,
    ready: false,
    playAgainReady: false,
    connected: true
  };
}

function allPlayersReady(room) {
  return room.players.length >= 2 && room.players.every(p => p.connected !== false && p.ready);
}

function restartRoomGame(io, room) {
  room.started = true;
  room.currentTurn = 0;
  room.state = null;
  room.finalWinCounted = false;
  room.players.forEach(player => {
    player.ready = false;
    player.playAgainReady = false;
  });
  io.to(room.roomCode).emit('gameStarted', publicRoom(room));
  broadcastRoom(io, room);
}

function registerSockets(io) {
  function removePlayer(socket, { permanent = false } = {}) {
    const room = findPlayerRoom(socket.id);
    if (!room) return;

    const player = room.players.find(player => player.id === socket.id);
    if (!player) return;

    socket.leave(room.roomCode);

    if (room.started && !permanent) {
      player.connected = false;
      player.id = null;
      io.to(room.roomCode).emit('playerDisconnected', {
        playerIndex: room.players.indexOf(player),
        name: player.name || `Player ${room.players.indexOf(player) + 1}`
      });
    } else {
      const removedIndex = room.players.indexOf(player);
      room.players = room.players.filter(p => p !== player);
      if (Array.isArray(room.winCounts) && removedIndex >= 0) room.winCounts.splice(removedIndex, 1);
    }

    if (room.players.length === 0 || room.players.every(p => p.connected === false)) {
      if (!room.started) rooms.delete(room.roomCode);
    }

    const connectedHost = room.players.find(p => p.id === room.hostId);
    if (!connectedHost) {
      const nextHost = room.players.find(p => p.connected !== false && p.id);
      if (nextHost) room.hostId = nextHost.id;
    }

    if (room.currentTurn >= room.players.length) room.currentTurn = 0;
    broadcastRoom(io, room);
  }

  io.on('connection', socket => {
    socket.on('createRoom', (data = {}) => {
      removePlayer(socket, { permanent: true });
      const roomCode = uniqueRoomCode();
      const room = {
        roomCode,
        hostId: socket.id,
        started: false,
        currentTurn: 0,
        state: null,
        chat: [],
        players: [makePlayer(socket, 0, data)],
        winCounts: [0],
        finalWinCounted: false
      };
      rooms.set(roomCode, room);
      socket.join(roomCode);
      broadcastRoom(io, room);
    });

    socket.on('joinRoom', (data = {}) => {
      let roomCode = String(data.roomCode || '').trim().toUpperCase();
      if (!roomCode) return socket.emit('errorMessage', 'Missing room code.');
      const room = rooms.get(roomCode);
      if (!room) return socket.emit('errorMessage', 'Room not found.');
      if (room.started) return socket.emit('errorMessage', 'That room already started.');
      if (room.players.length >= 4) return socket.emit('errorMessage', 'That room is full.');

      removePlayer(socket, { permanent: true });
      room.players.push(makePlayer(socket, room.players.length, data));
      if (!Array.isArray(room.winCounts)) room.winCounts = [];
      room.winCounts[room.players.length - 1] = room.winCounts[room.players.length - 1] || 0;
      socket.join(roomCode);
      broadcastRoom(io, room);
    });

    socket.on('updateProfile', ({ roomCode, name, colorIndex } = {}) => {
      roomCode = String(roomCode || '').trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room || room.started) return;
      const playerIndex = room.players.findIndex(player => player.id === socket.id);
      if (playerIndex < 0) return;
      const player = room.players[playerIndex];
      player.name = cleanName(name, `Player ${playerIndex + 1}`);
      const parsedColor = Number(colorIndex);
      if (Number.isInteger(parsedColor)) player.colorIndex = Math.max(0, Math.min(9, parsedColor));
      broadcastRoom(io, room);
    });

    socket.on('toggleReady', ({ roomCode } = {}) => {
      roomCode = String(roomCode || '').trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room || room.started) return;
      const player = room.players.find(player => player.id === socket.id);
      if (!player) return;
      player.ready = !player.ready;
      broadcastRoom(io, room);
    });

    socket.on('chatMessage', ({ roomCode, text } = {}) => {
      roomCode = String(roomCode || '').trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) return;
      const playerIndex = room.players.findIndex(player => player.id === socket.id);
      if (playerIndex < 0) return;
      const message = String(text || '').trim().slice(0, 100);
      if (!message) return;
      if (!Array.isArray(room.chat)) room.chat = [];
      room.chat.push({
        name: cleanName(room.players[playerIndex].name, `Player ${playerIndex + 1}`),
        text: message,
        time: Date.now()
      });
      room.chat = room.chat.slice(-40);
      broadcastRoom(io, room);
    });

    socket.on('leaveRoom', () => removePlayer(socket, { permanent: true }));

    socket.on('startGame', ({ roomCode } = {}) => {
      const room = rooms.get(String(roomCode || '').trim().toUpperCase());
      if (!room) return socket.emit('errorMessage', 'Room not found.');
      if (socket.id !== room.hostId) return socket.emit('errorMessage', 'Only the host can start.');
      if (room.players.length < 2) return socket.emit('errorMessage', 'Need at least 2 players.');
      if (!allPlayersReady(room)) return socket.emit('errorMessage', 'Everyone needs to be ready first.');
      restartRoomGame(io, room);
    });

    socket.on('playAgainReady', ({ roomCode } = {}) => {
      const room = rooms.get(String(roomCode || '').trim().toUpperCase());
      if (!room || !room.started || !room.state || !room.state.finalResultsReady) return;
      const player = room.players.find(player => player.id === socket.id);
      if (!player) return;
      player.playAgainReady = true;
      broadcastRoom(io, room);
      const connectedPlayers = room.players.filter(p => p.connected !== false && p.id);
      if (connectedPlayers.length >= 2 && connectedPlayers.every(p => p.playAgainReady)) {
        restartRoomGame(io, room);
      }
    });

    socket.on('stateUpdate', state => {
      const roomCode = String(state?.roomCode || '').trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room || !room.started) return;

      const senderIndex = room.players.findIndex(player => player.id === socket.id);
      if (senderIndex < 0) return;
      if (senderIndex !== room.currentTurn) return socket.emit('errorMessage', 'Not your turn.');

      const nextTurn = Number(state.currentTurn);
      if (Number.isInteger(nextTurn) && nextTurn >= 0 && nextTurn < room.players.length) {
        room.currentTurn = nextTurn;
      }

      const statePlayers = Array.isArray(state.players) ? state.players : [];
      if (state.finalResultsReady) countGameWinner(room, statePlayers);

      room.state = {
        currentTurn: room.currentTurn,
        players: statePlayers,
        finalResultsReady: !!state.finalResultsReady,
        winCounts: Array.isArray(room.winCounts) ? room.winCounts.slice(0, room.players.length) : room.players.map(() => 0)
      };

      if (state.finalResultsReady) broadcastRoom(io, room);
      socket.to(room.roomCode).emit('stateUpdate', room.state);
    });

    socket.on('rollReplayStart', data => {
      const roomCode = String(data?.roomCode || '').trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room || !room.started) return;
      const senderIndex = room.players.findIndex(player => player.id === socket.id);
      if (senderIndex < 0 || senderIndex !== room.currentTurn) return;
      socket.to(room.roomCode).emit('rollReplayStart', { ...data, playerIndex: senderIndex });
    });

    socket.on('rollReplayEnd', data => {
      const roomCode = String(data?.roomCode || '').trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room || !room.started) return;
      const senderIndex = room.players.findIndex(player => player.id === socket.id);
      if (senderIndex < 0) return;
      socket.to(room.roomCode).emit('rollReplayEnd', { ...data, playerIndex: senderIndex });
    });

    socket.on('reconnectRoom', ({ roomCode, clientId } = {}) => {
      roomCode = String(roomCode || '').trim().toUpperCase();
      clientId = String(clientId || '');
      const room = rooms.get(roomCode);
      if (!room) return socket.emit('errorMessage', 'Room no longer exists.');
      const player = room.players.find(p => p.clientId === clientId);
      if (!player) return socket.emit('errorMessage', 'No saved seat found for that room.');

      player.id = socket.id;
      player.connected = true;
      socket.join(room.roomCode);
      if (!room.hostId || !room.players.some(p => p.id === room.hostId)) room.hostId = socket.id;
      socket.emit('reconnectedRoom', { room: publicRoom(room), state: room.state });
      broadcastRoom(io, room);
    });

    socket.on('disconnect', () => removePlayer(socket));
  });
}

module.exports = { registerSockets };
