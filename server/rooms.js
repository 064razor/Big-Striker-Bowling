const rooms = new Map();

function makeRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

function uniqueRoomCode() {
  let code = makeRoomCode();
  while (rooms.has(code)) code = makeRoomCode();
  return code;
}

function cleanName(value, fallback) {
  const text = String(value || '').trim().slice(0, 18);
  return text || fallback;
}

function publicRoom(room) {
  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    started: room.started,
    currentTurn: room.currentTurn,
    chat: Array.isArray(room.chat) ? room.chat.slice(-40) : [],
    winCounts: Array.isArray(room.winCounts) ? room.winCounts.slice(0, room.players.length) : room.players.map(() => 0),
    players: room.players.map((player, index) => ({
      id: player.id,
      clientId: player.clientId,
      connected: player.connected !== false,
      name: cleanName(player.name, `Player ${index + 1}`),
      colorIndex: player.colorIndex,
      ready: !!player.ready,
      playAgainReady: !!player.playAgainReady,
      wins: Array.isArray(room.winCounts) ? (room.winCounts[index] || 0) : 0
    }))
  };
}

function broadcastRoom(io, room) {
  io.to(room.roomCode).emit('roomUpdate', publicRoom(room));
}

function findPlayerRoom(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some(player => player.id === socketId)) return room;
  }
  return null;
}

module.exports = { rooms, uniqueRoomCode, publicRoom, broadcastRoom, findPlayerRoom, cleanName };
