const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let ball;
let pins = [];
let dragging = false;
let dragStart = null;
let dragCurrent = null;

let frame = 1;
let rollInFrame = 1;
let rolls = [];
let pinsStandingBeforeRoll = 10;
let waitingForNextRoll = false;
let gameOver = false;
let rollTimer = 0;
let strikeStreak = 0;
let announcer = { text: "", subtext: "", timer: 0, duration: 1, shake: false };
let pinMachine = { active: false, timer: 0, duration: 96, mode: "frame", didSwitch: false };
const maxRollTime = 420;


let audioCtx = null;
let soundEnabled = true;
let rollingOsc = null;
let rollingGain = null;
let rollingFilter = null;
let rollingRumbleBuffer = null;
let pinsetterOsc = null;
let pinsetterGain = null;
let pinsetterFilter = null;
let pinsetterLfo = null;
let pinsetterLfoGain = null;
let lastClashFrame = 0;
let audioFrame = 0;
let activeSfxTails = [];
let universalReverbInput = null;
let universalReverbDelay = null;
let universalReverbFeedback = null;
let universalReverbFilter = null;
let universalReverbWet = null;


const ballPalettes = [
  { name: "Neon Blue", top: "#8ff4ff", mid: "#7657ff", low: "#201850", edge: "#080710", glow: "rgba(111, 229, 255," },
  { name: "Hot Pink", top: "#ffd2fb", mid: "#ff4fd8", low: "#64145f", edge: "#180018", glow: "rgba(255, 79, 216," },
  { name: "Fireball", top: "#ffe29a", mid: "#ff7a1f", low: "#84250b", edge: "#1b0602", glow: "rgba(255, 122, 31," },
  { name: "Lime Pop", top: "#e5ffb3", mid: "#62ff66", low: "#126528", edge: "#021607", glow: "rgba(98, 255, 102," },
  { name: "Gold Rush", top: "#fff4a8", mid: "#ffd36a", low: "#8d5a08", edge: "#211301", glow: "rgba(255, 211, 106," },
  { name: "Cherry Red", top: "#ffc0c0", mid: "#ff3434", low: "#7d1010", edge: "#190000", glow: "rgba(255, 52, 52," },
  { name: "Royal Purple", top: "#ead7ff", mid: "#a35cff", low: "#3d1676", edge: "#0d0419", glow: "rgba(163, 92, 255," },
  { name: "Aqua Mint", top: "#d4fff7", mid: "#30f0c8", low: "#0b6a68", edge: "#021817", glow: "rgba(48, 240, 200," },
  { name: "Classic Black", top: "#777777", mid: "#2e2e34", low: "#101014", edge: "#030304", glow: "rgba(190, 190, 210," },
  { name: "Pearl White", top: "#ffffff", mid: "#d8ecff", low: "#768ba5", edge: "#202a36", glow: "rgba(216, 236, 255," }
];

let selectedBallColor = Number(localStorage.getItem("bowlingBallColorIndex") || 0);
if (!Number.isInteger(selectedBallColor) || selectedBallColor < 0 || selectedBallColor >= ballPalettes.length) {
  selectedBallColor = 0;
}


let menuMode = "single";
let menuPlayerCount = 2;
let gameStarted = false;
let multiplayerMode = false;
let playerCount = 1;
let players = [];
let currentPlayerIndex = 0;
let pendingTurnChange = false;
let finalResultsReady = false;
let colorsLockedForGame = false;
let matchWinCounts = [];
let finalWinCountedLocal = false;

let onlineMode = false;
let socket = null;
let onlineRoomCode = "";
let onlineIsHost = false;
let myOnlinePlayerIndex = -1;
let onlineGameActive = false;
let applyingOnlineUpdate = false;
let onlineClientId = localStorage.getItem('bigStrikerOnlineClientId') || '';
if (!onlineClientId) {
  onlineClientId = 'client-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem('bigStrikerOnlineClientId', onlineClientId);
}
let replayMode = false;
let replayTimer = 0;
let currentReplaySnapshot = null;
let onlineWinCounts = [];
let latestOnlineRoom = null;
let onlinePlayAgainReady = false;

function makePlayer(index, colorIndex) {
  return {
    name: "Player " + (index + 1),
    colorIndex,
    frame: 1,
    rollInFrame: 1,
    rolls: [],
    pinsStandingBeforeRoll: 10,
    strikeStreak: 0,
    gameOver: false
  };
}

function saveCurrentPlayerState() {
  if (!players[currentPlayerIndex]) return;
  const player = players[currentPlayerIndex];
  player.frame = frame;
  player.rollInFrame = rollInFrame;
  player.rolls = rolls.slice();
  player.pinsStandingBeforeRoll = pinsStandingBeforeRoll;
  player.strikeStreak = strikeStreak;
  player.gameOver = gameOver;
}

function loadPlayerState(index) {
  currentPlayerIndex = index;
  const player = players[currentPlayerIndex];
  frame = player.frame;
  rollInFrame = player.rollInFrame;
  rolls = player.rolls.slice();
  pinsStandingBeforeRoll = player.pinsStandingBeforeRoll;
  strikeStreak = player.strikeStreak;
  gameOver = player.gameOver;
  selectedBallColor = player.colorIndex;
  localStorage.setItem("bowlingBallColorIndex", String(selectedBallColor));
  createBall();
  createPins();
  updateBallColorButtons();
  updateHud();
  updateTurnBanner();
  emitOnlineState();
}

function getNextActivePlayerIndex() {
  if (!multiplayerMode) return currentPlayerIndex;
  for (let step = 1; step <= players.length; step++) {
    const next = (currentPlayerIndex + step) % players.length;
    if (!players[next].gameOver) return next;
  }
  return -1;
}

function allPlayersFinished() {
  return multiplayerMode && players.length > 0 && players.every(player => player.gameOver);
}

function advanceToNextPlayer() {
  saveCurrentPlayerState();
  pendingTurnChange = false;

  const next = getNextActivePlayerIndex();
  if (next < 0) {
    finalResultsReady = true;
    gameOver = true;
    updateTurnBanner();
    return;
  }

  loadPlayerState(next);
  announcer = { text: "", subtext: "", timer: 0, duration: 1, shake: false };
  const messageText = document.getElementById("messageText");
  if (messageText) messageText.textContent = players[next].name + " is up.";
  showAnnouncer(players[next].name, "Step up!", 82, false);
  emitOnlineState();
}

function updateTurnBanner() {
  const banner = document.getElementById("turnBanner");
  if (!banner) return;

  if (!gameStarted || !multiplayerMode || finalResultsReady) {
    banner.classList.remove("active");
    return;
  }

  const player = players[currentPlayerIndex];
  const onlineNote = onlineMode ? (currentPlayerIndex === myOnlinePlayerIndex ? "  •  YOUR TURN" : "  •  WAITING") : "";
  banner.textContent = `${player.name}  •  Frame ${Math.min(frame, 10)}  •  Roll ${rollInFrame}${onlineNote}`;
  banner.classList.add("active");
}

function openMenu() {
  leaveOnlineRoom();
  gameStarted = false;
  colorsLockedForGame = false;
  const menu = document.getElementById("mainMenu");
  const shell = document.getElementById("gameShell");
  if (menu) menu.classList.remove("hidden");
  if (shell) shell.classList.add("menu-locked");
  const panel = document.getElementById("ballColorPanel");
  if (panel) panel.classList.remove("locked");
  stopRollLoop();
  stopPinsetterWhirl();
  buildMenuPlayerSetup();
  updateTurnBanner();
}

function exitToMenu() {
  resetGame(false);
  openMenu();
}

function startConfiguredGame() {
  if (menuMode === "online") return;
  gameStarted = true;
  multiplayerMode = menuMode === "multi";
  playerCount = multiplayerMode ? menuPlayerCount : 1;
  colorsLockedForGame = true;
  finalResultsReady = false;
  finalWinCountedLocal = false;
  pendingTurnChange = false;
  currentPlayerIndex = 0;
  players = [];
  matchWinCounts = [];

  for (let i = 0; i < playerCount; i++) {
    const select = document.getElementById("menuColor" + i);
    const fallback = i % ballPalettes.length;
    const colorIndex = select ? Number(select.value) : fallback;
    players.push(makePlayer(i, Number.isInteger(colorIndex) ? colorIndex : fallback));
    matchWinCounts.push(0);
  }

  selectedBallColor = players[0].colorIndex;
  localStorage.setItem("bowlingBallColorIndex", String(selectedBallColor));

  const menu = document.getElementById("mainMenu");
  const shell = document.getElementById("gameShell");
  if (menu) menu.classList.add("hidden");
  if (shell) shell.classList.remove("menu-locked");
  const panel = document.getElementById("ballColorPanel");
  if (panel) panel.classList.add("locked");

  resetGame(false);
  loadPlayerState(0);
  const messageText = document.getElementById("messageText");
  if (messageText) messageText.textContent = multiplayerMode ? "Player 1 is up." : "Pick your spot behind the red line.";
}

function buildMenuPlayerSetup() {
  const grid = document.getElementById("playerSetupGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const visiblePlayers = menuMode === "single" ? 1 : (menuMode === "online" ? 1 : menuPlayerCount);

  for (let i = 0; i < 4; i++) {
    const card = document.createElement("div");
    card.className = "player-setup-card" + (i >= visiblePlayers ? " hidden" : "");

    const title = document.createElement("strong");
    title.textContent = "Player " + (i + 1);
    card.appendChild(title);

    const select = document.createElement("select");
    select.id = "menuColor" + i;

    ballPalettes.forEach((palette, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = palette.name;
      select.appendChild(option);
    });

    select.value = String((selectedBallColor + i) % ballPalettes.length);
    card.appendChild(select);

    const preview = document.createElement("div");
    preview.className = "player-ball-preview";
    card.appendChild(preview);

    function updatePreview() {
      const palette = ballPalettes[Number(select.value)] || ballPalettes[0];
      preview.style.background = `radial-gradient(circle at 32% 25%, ${palette.top}, ${palette.mid} 45%, ${palette.low} 72%, ${palette.edge})`;
    }

    select.addEventListener("change", () => { updatePreview(); if (menuMode === "online") sendOnlineProfileUpdate(); });
    updatePreview();
    grid.appendChild(card);
  }
}

function setupMenuControls() {
  const single = document.getElementById("singleModeButton");
  const multi = document.getElementById("multiModeButton");
  const online = document.getElementById("onlineModeButton");
  const onlinePanel = document.getElementById("onlinePanel");
  const normalStart = document.getElementById("startGameButton");
  const countRow = document.getElementById("playerCountRow");
  const start = document.getElementById("startGameButton");

  function refreshModeButtons() {
    if (single) single.classList.toggle("selected", menuMode === "single");
    if (multi) multi.classList.toggle("selected", menuMode === "multi");
    if (online) online.classList.toggle("selected", menuMode === "online");
    if (countRow) countRow.style.display = menuMode === "multi" ? "flex" : "none";
    if (onlinePanel) onlinePanel.style.display = menuMode === "online" ? "block" : "none";
    if (normalStart) normalStart.style.display = menuMode === "online" ? "none" : "inline-block";
    document.querySelectorAll(".menu-small-button[data-count]").forEach(button => {
      button.classList.toggle("selected", Number(button.dataset.count) === menuPlayerCount && menuMode === "multi");
    });
    buildMenuPlayerSetup();
  }

  if (single) single.addEventListener("click", () => { menuMode = "single"; refreshModeButtons(); });
  if (multi) multi.addEventListener("click", () => { menuMode = "multi"; refreshModeButtons(); });
  if (online) online.addEventListener("click", () => { menuMode = "online"; refreshModeButtons(); initOnlineControls(); });
  document.querySelectorAll(".menu-small-button[data-count]").forEach(button => {
    button.addEventListener("click", () => {
      menuPlayerCount = clamp(Number(button.dataset.count) || 2, 2, 4);
      refreshModeButtons();
    });
  });
  if (start) start.addEventListener("click", startConfiguredGame);

  refreshModeButtons();
}



function selectedOnlineName() {
  const input = document.getElementById("onlineNameInput");
  const fallback = myOnlinePlayerIndex >= 0 ? "Player " + (myOnlinePlayerIndex + 1) : "Player 1";
  return input && input.value.trim() ? input.value.trim().slice(0, 18) : fallback;
}

function sendOnlineProfileUpdate() {
  if (!socket || !onlineRoomCode || onlineGameActive) return;
  socket.emit("updateProfile", {
    roomCode: onlineRoomCode,
    name: selectedOnlineName(),
    colorIndex: selectedOnlineColor()
  });
}

function findMyRoomPlayer(room) {
  if (!room || !Array.isArray(room.players) || !socket) return null;
  return room.players.find(player => player.id === socket.id || player.clientId === onlineClientId) || null;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function updatePlayAgainButton() {
  const btn = document.getElementById("playAgainButton");
  if (!btn) return;
  const show = onlineMode && onlineGameActive && finalResultsReady;
  btn.style.display = show ? "inline-block" : "none";
  btn.disabled = onlinePlayAgainReady;
  btn.textContent = onlinePlayAgainReady ? "Ready for Rematch" : "Play Again";
}

function requestOnlinePlayAgain() {
  if (!onlineMode || !socket || !onlineRoomCode || !finalResultsReady) return;
  onlinePlayAgainReady = true;
  updatePlayAgainButton();
  socket.emit("playAgainReady", { roomCode: onlineRoomCode });
}

function initOnlineControls() {
  const createBtn = document.getElementById("createRoomButton");
  const joinBtn = document.getElementById("joinRoomButton");
  const startBtn = document.getElementById("startOnlineButton");
  const readyBtn = document.getElementById("readyOnlineButton");
  const copyBtn = document.getElementById("copyRoomButton");
  const sendChatBtn = document.getElementById("sendChatButton");
  const chatInput = document.getElementById("chatInput");
  const nameInput = document.getElementById("onlineNameInput");
  if (createBtn && !createBtn.dataset.ready) {
    createBtn.dataset.ready = "1";
    createBtn.addEventListener("click", createOnlineRoom);
  }
  if (joinBtn && !joinBtn.dataset.ready) {
    joinBtn.dataset.ready = "1";
    joinBtn.addEventListener("click", joinOnlineRoom);
  }
  if (startBtn && !startBtn.dataset.ready) {
    startBtn.dataset.ready = "1";
    startBtn.addEventListener("click", startOnlineGame);
  }
  if (readyBtn && !readyBtn.dataset.ready) {
    readyBtn.dataset.ready = "1";
    readyBtn.addEventListener("click", toggleOnlineReady);
  }
  if (copyBtn && !copyBtn.dataset.ready) {
    copyBtn.dataset.ready = "1";
    copyBtn.addEventListener("click", copyOnlineRoomCode);
  }
  if (sendChatBtn && !sendChatBtn.dataset.ready) {
    sendChatBtn.dataset.ready = "1";
    sendChatBtn.addEventListener("click", sendOnlineChat);
  }
  if (chatInput && !chatInput.dataset.ready) {
    chatInput.dataset.ready = "1";
    chatInput.addEventListener("keydown", event => { if (event.key === "Enter") sendOnlineChat(); });
  }
  if (nameInput && !nameInput.dataset.ready) {
    nameInput.dataset.ready = "1";
    nameInput.value = localStorage.getItem("bigStrikerOnlineName") || "";
    nameInput.addEventListener("input", () => {
      localStorage.setItem("bigStrikerOnlineName", nameInput.value.trim().slice(0, 18));
      sendOnlineProfileUpdate();
    });
  }
  renderOnlineSlots([]);
}

function ensureSocket() {
  if (typeof io === "undefined") {
    setOnlineStatus("Online needs the Node/Socket.IO server. Run npm install, then npm start.");
    return null;
  }
  if (socket) return socket;

  socket = io();

  socket.on("connect", () => {
    setOnlineStatus("Connected. Create or join a room.");
    const savedRoom = localStorage.getItem('bigStrikerOnlineRoomCode');
    if (savedRoom && onlineMode) {
      socket.emit('reconnectRoom', { roomCode: savedRoom, clientId: onlineClientId });
    }
  });
  socket.on("roomUpdate", handleRoomUpdate);
  socket.on("gameStarted", handleOnlineGameStarted);
  socket.on("stateUpdate", handleOnlineStateUpdate);
  socket.on("rollReplayStart", handleOnlineRollReplayStart);
  socket.on("rollReplayEnd", handleOnlineRollReplayEnd);
  socket.on("playerDisconnected", data => {
    const name = data && data.name ? data.name : "A player";
    setOnlineStatus(name + " disconnected. Their seat is held for reconnect.");
  });
  socket.on("reconnectedRoom", handleOnlineReconnected);
  socket.on("roomClosed", () => {
    setOnlineStatus("Room closed.");
    leaveOnlineRoom(false);
  });
  socket.on("errorMessage", msg => setOnlineStatus(msg));
  socket.on("disconnect", () => setOnlineStatus("Disconnected from online server. Reconnect will be attempted automatically."));

  return socket;
}

function selectedOnlineColor() {
  const select = document.getElementById("menuColor0");
  const colorIndex = select ? Number(select.value) : selectedBallColor;
  return Number.isInteger(colorIndex) ? colorIndex : 0;
}


function toggleOnlineReady() {
  if (!socket || !onlineRoomCode) return;
  socket.emit("toggleReady", { roomCode: onlineRoomCode });
}

function copyOnlineRoomCode() {
  if (!onlineRoomCode) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(onlineRoomCode).then(() => setOnlineStatus("Room code copied: " + onlineRoomCode));
  } else {
    setOnlineStatus("Room code: " + onlineRoomCode);
  }
}

function sendOnlineChat() {
  if (!socket || !onlineRoomCode) return;
  const input = document.getElementById("chatInput");
  const text = input ? input.value.trim() : "";
  if (!text) return;
  socket.emit("chatMessage", { roomCode: onlineRoomCode, text });
  input.value = "";
}

function renderOnlineChat(chat) {
  const panel = document.getElementById("onlineChat");
  const list = document.getElementById("chatMessages");
  if (!panel || !list) return;
  panel.style.display = onlineRoomCode ? "block" : "none";
  const messages = Array.isArray(chat) ? chat.slice(-40) : [];
  list.innerHTML = messages.length ? messages.map(message => `
    <div class="chat-message"><strong>${escapeHtml(message.name)}:</strong> ${escapeHtml(message.text)}</div>
  `).join("") : '<div class="chat-empty">No messages yet.</div>';
  list.scrollTop = list.scrollHeight;
}

function createOnlineRoom() {
  const s = ensureSocket();
  if (!s) return;
  onlineMode = true;
  s.emit("createRoom", { colorIndex: selectedOnlineColor(), name: selectedOnlineName(), clientId: onlineClientId });
}

function joinOnlineRoom() {
  const s = ensureSocket();
  if (!s) return;
  const input = document.getElementById("roomCodeInput");
  const roomCode = input ? input.value.trim().toUpperCase() : "";
  if (!roomCode) {
    setOnlineStatus("Enter a room code first.");
    return;
  }
  onlineMode = true;
  s.emit("joinRoom", { roomCode, colorIndex: selectedOnlineColor(), name: selectedOnlineName(), clientId: onlineClientId });
}

function leaveOnlineRoom(tellServer = true) {
  if (socket && tellServer && onlineRoomCode) socket.emit("leaveRoom", { roomCode: onlineRoomCode });
  if (tellServer) localStorage.removeItem('bigStrikerOnlineRoomCode');
  onlineMode = false;
  onlineRoomCode = "";
  onlineIsHost = false;
  myOnlinePlayerIndex = -1;
  onlineGameActive = false;
  latestOnlineRoom = null;
  onlinePlayAgainReady = false;
  const startBtn = document.getElementById("startOnlineButton");
  if (startBtn) startBtn.disabled = true;
  const readyBtn = document.getElementById("readyOnlineButton");
  if (readyBtn) { readyBtn.disabled = true; readyBtn.textContent = "Ready: No"; }
  const copyBtn = document.getElementById("copyRoomButton");
  if (copyBtn) copyBtn.disabled = true;
  renderOnlineChat([]);
  updatePlayAgainButton();
  renderOnlineSlots([]);
}

function handleRoomUpdate(room) {
  latestOnlineRoom = room;
  onlineMode = true;
  onlineRoomCode = room.roomCode;
  localStorage.setItem('bigStrikerOnlineRoomCode', onlineRoomCode);
  onlineIsHost = room.hostId === socket.id;
  onlineWinCounts = Array.isArray(room.winCounts) ? room.winCounts.slice() : room.players.map(player => player.wins || 0);
  matchWinCounts = onlineWinCounts.slice();
  myOnlinePlayerIndex = room.players.findIndex(player => player.id === socket.id || player.clientId === onlineClientId);
  const me = findMyRoomPlayer(room);
  onlinePlayAgainReady = !!(me && me.playAgainReady);
  const input = document.getElementById("roomCodeInput");
  if (input) input.value = room.roomCode;
  const copyBtn = document.getElementById("copyRoomButton");
  if (copyBtn) copyBtn.disabled = !room.roomCode;
  const readyBtn = document.getElementById("readyOnlineButton");
  if (readyBtn) {
    readyBtn.disabled = room.started || !me;
    readyBtn.textContent = me && me.ready ? "Ready: Yes" : "Ready: No";
    readyBtn.classList.toggle("ready-active", !!(me && me.ready));
  }
  const allReady = room.players.length >= 2 && room.players.every(player => player.ready && player.connected !== false);
  const startBtn = document.getElementById("startOnlineButton");
  if (startBtn) {
    startBtn.disabled = !onlineIsHost || !allReady || room.started;
    startBtn.title = allReady ? "Start the match" : "Everyone must be ready first";
  }
  setOnlineStatus(`Room ${room.roomCode} — ${onlineIsHost ? "you are host" : "waiting for host"}${room.started ? "" : allReady ? " — everyone is ready" : " — waiting for ready checks"}.`);
  renderOnlineSlots(room.players);
  renderOnlineChat(room.chat);
  updatePlayAgainButton();
}

function renderOnlineSlots(roomPlayers) {
  const slots = document.getElementById("onlineSlots");
  if (!slots) return;
  slots.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const slot = document.createElement("div");
    const player = roomPlayers[i];
    slot.className = "online-slot" + (player ? "" : " empty") + (player && socket && player.id === socket.id ? " me" : "") + (player && player.connected === false ? " disconnected" : "");
    if (player) {
      const palette = ballPalettes[player.colorIndex] || ballPalettes[0];
      const wins = Number(player.wins ?? onlineWinCounts[i] ?? matchWinCounts[i] ?? 0) || 0;
      const winText = wins === 1 ? '1 win' : wins + ' wins';
      const readyText = player.ready ? 'Ready ✓' : 'Not Ready';
      slot.innerHTML = `<span class="online-ball-dot" style="background:${palette.mid}"></span><span class="slot-main"><strong>${escapeHtml(player.name || ('Player ' + (i + 1)))}</strong><small>${palette.name} • ${winText} • ${readyText}${player.connected === false ? ' • Reconnecting' : ''}</small></span>`;
    } else {
      slot.textContent = `Player ${i + 1} • Empty`;
    }
    slots.appendChild(slot);
  }
}

function setOnlineStatus(text) {
  const status = document.getElementById("onlineStatus");
  if (status) status.textContent = text;
}

function startOnlineGame() {
  if (!socket || !onlineRoomCode || !onlineIsHost) return;
  socket.emit("startGame", { roomCode: onlineRoomCode });
}

function handleOnlineGameStarted(room) {
  onlineMode = true;
  onlineGameActive = true;
  onlinePlayAgainReady = false;
  updatePlayAgainButton();
  localStorage.setItem('bigStrikerOnlineRoomCode', room.roomCode);
  gameStarted = true;
  multiplayerMode = true;
  playerCount = room.players.length;
  colorsLockedForGame = true;
  finalResultsReady = false;
  finalWinCountedLocal = false;
  pendingTurnChange = false;
  currentPlayerIndex = room.currentTurn || 0;
  onlineWinCounts = Array.isArray(room.winCounts) ? room.winCounts.slice() : room.players.map(player => player.wins || 0);
  matchWinCounts = onlineWinCounts.slice();
  players = room.players.map((player, index) => { const p = makePlayer(index, player.colorIndex); p.name = player.name || p.name; return p; });
  myOnlinePlayerIndex = room.players.findIndex(player => player.id === socket.id);

  const menu = document.getElementById("mainMenu");
  const shell = document.getElementById("gameShell");
  if (menu) menu.classList.add("hidden");
  if (shell) shell.classList.remove("menu-locked");
  const panel = document.getElementById("ballColorPanel");
  if (panel) panel.classList.add("locked");

  loadPlayerState(currentPlayerIndex);
  const messageText = document.getElementById("messageText");
  if (messageText) messageText.textContent = canCurrentClientRoll() ? "Your turn. Pick your spot." : `${players[currentPlayerIndex].name} is up. Waiting...`;
}


function handleOnlineReconnected(payload) {
  const room = payload && payload.room;
  if (!room) return;
  handleRoomUpdate(room);
  if (room.started) {
    onlineMode = true;
    onlineGameActive = true;
    gameStarted = true;
    multiplayerMode = true;
    playerCount = room.players.length;
    colorsLockedForGame = true;
    myOnlinePlayerIndex = room.players.findIndex(player => player.id === socket.id || player.clientId === onlineClientId);
    if (!players.length || players.length !== room.players.length) {
      players = room.players.map((player, index) => { const p = makePlayer(index, player.colorIndex); p.name = player.name || p.name; return p; });
    }
    const menu = document.getElementById("mainMenu");
    const shell = document.getElementById("gameShell");
    if (menu) menu.classList.add("hidden");
    if (shell) shell.classList.remove("menu-locked");
    const panel = document.getElementById("ballColorPanel");
    if (panel) panel.classList.add("locked");
    if (payload.state) {
      handleOnlineStateUpdate(payload.state);
    } else {
      currentPlayerIndex = room.currentTurn || 0;
      loadPlayerState(currentPlayerIndex);
    }
    setOnlineStatus("Reconnected to room " + room.roomCode + ".");
  }
}

function canCurrentClientRoll() {
  if (!onlineMode) return true;
  return onlineGameActive && currentPlayerIndex === myOnlinePlayerIndex && !finalResultsReady;
}


function emitOnlineRollReplayStart() {
  if (!onlineMode || !socket || !onlineRoomCode || applyingOnlineUpdate) return;
  currentReplaySnapshot = {
    roomCode: onlineRoomCode,
    x: ball.x,
    y: ball.y,
    vx: ball.vx,
    vy: ball.vy,
    colorIndex: selectedBallColor,
    frame,
    rollInFrame,
    pinsStandingBeforeRoll
  };
  socket.emit("rollReplayStart", currentReplaySnapshot);
}

function emitOnlineRollReplayEnd(knockedPins, wasGutter) {
  if (!onlineMode || !socket || !onlineRoomCode || applyingOnlineUpdate || !currentReplaySnapshot) return;
  socket.emit("rollReplayEnd", {
    roomCode: onlineRoomCode,
    knockedPins,
    wasGutter,
    score: calculateScore(),
    frame,
    rollInFrame
  });
  currentReplaySnapshot = null;
}

function handleOnlineRollReplayStart(data) {
  if (!onlineMode || !onlineGameActive) return;
  if (data.playerIndex === myOnlinePlayerIndex) return;
  replayMode = true;
  replayTimer = 0;
  waitingForNextRoll = true;
  announcer = { text: "", subtext: "", timer: 0, duration: 1, shake: false };
  const player = players[data.playerIndex] || { name: "Player " + ((data.playerIndex || 0) + 1) };
  const messageText = document.getElementById("messageText");
  if (messageText) messageText.textContent = "Watching " + player.name + " roll...";
  selectedBallColor = Number(data.colorIndex) || 0;
  createBall();
  createPins();
  ball.x = Number(data.x) || ball.x;
  ball.y = Number(data.y) || ball.y;
  ball.vx = Number(data.vx) || 0;
  ball.vy = Number(data.vy) || -5;
  ball.moving = true;
  ball.releasePower = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  ball.driftForce = 0;
  ball.driftLife = 0;
  startRollLoop();
}

function handleOnlineRollReplayEnd(data) {
  if (!onlineMode || !onlineGameActive) return;
  if (data.playerIndex === myOnlinePlayerIndex) return;
  const player = players[data.playerIndex] || { name: "Player " + ((data.playerIndex || 0) + 1) };
  const knocked = Number(data.knockedPins) || 0;
  const sub = data.wasGutter ? "Gutter ball" : (knocked === 1 ? "1 pin" : knocked + " pins");
  showAnnouncer(player.name + " rolled", sub, 95, false);
}

function emitOnlineState() {
  if (!onlineMode || !socket || !onlineRoomCode || applyingOnlineUpdate) return;
  saveCurrentPlayerState();
  socket.emit("stateUpdate", {
    roomCode: onlineRoomCode,
    currentTurn: currentPlayerIndex,
    players: players.map(player => ({
      frame: player.frame,
      rollInFrame: player.rollInFrame,
      rolls: player.rolls,
      pinsStandingBeforeRoll: player.pinsStandingBeforeRoll,
      strikeStreak: player.strikeStreak,
      gameOver: player.gameOver,
      colorIndex: player.colorIndex,
      name: player.name,
      score: calculateScoreForRolls(player.rolls)
    })),
    finalResultsReady,
    winCounts: matchWinCounts.slice()
  });
}

function handleOnlineStateUpdate(state) {
  if (!onlineMode || !onlineGameActive) return;
  replayMode = false;
  stopRollLoop();
  applyingOnlineUpdate = true;
  players.forEach((player, index) => {
    const incoming = state.players[index];
    if (!incoming) return;
    player.frame = incoming.frame;
    player.rollInFrame = incoming.rollInFrame;
    player.rolls = incoming.rolls.slice();
    player.pinsStandingBeforeRoll = incoming.pinsStandingBeforeRoll;
    player.strikeStreak = incoming.strikeStreak;
    player.gameOver = incoming.gameOver;
    player.colorIndex = incoming.colorIndex;
    if (incoming.name) player.name = incoming.name;
  });
  currentPlayerIndex = state.currentTurn;
  finalResultsReady = !!state.finalResultsReady;
  if (Array.isArray(state.winCounts)) {
    onlineWinCounts = state.winCounts.slice();
    matchWinCounts = onlineWinCounts.slice();
  }
  loadPlayerState(currentPlayerIndex);
  if (finalResultsReady) gameOver = true;
  const messageText = document.getElementById("messageText");
  if (messageText) messageText.textContent = canCurrentClientRoll() ? "Your turn. Pick your spot." : `${players[currentPlayerIndex].name} is up. Waiting...`;
  updatePlayAgainButton();
  applyingOnlineUpdate = false;
}

function calculateScoreForRolls(sourceRolls) {
  let score = 0;
  let index = 0;
  for (let f = 1; f <= 10; f++) {
    if (sourceRolls[index] === undefined) break;
    if (sourceRolls[index] === 10) {
      if (sourceRolls[index + 1] === undefined || sourceRolls[index + 2] === undefined) break;
      score += 10 + sourceRolls[index + 1] + sourceRolls[index + 2];
      index++;
    } else {
      const a = sourceRolls[index];
      const b = sourceRolls[index + 1];
      if (b === undefined) break;
      if (a + b === 10) {
        if (sourceRolls[index + 2] === undefined) break;
        score += 10 + sourceRolls[index + 2];
      } else {
        score += a + b;
      }
      index += 2;
    }
  }
  return score;
}

function getBallPalette() {
  return ballPalettes[selectedBallColor] || ballPalettes[0];
}

function setBallColor(index) {
  if (colorsLockedForGame) return;
  selectedBallColor = index;
  localStorage.setItem("bowlingBallColorIndex", String(index));
  updateBallColorButtons();
}

function buildBallColorButtons() {
  const holder = document.getElementById("ballColorChoices");
  if (!holder) return;

  holder.innerHTML = "";
  holder.style.display = "inline-flex";
  holder.style.gap = "7px";
  holder.style.flexWrap = "wrap";
  holder.style.justifyContent = "center";

  ballPalettes.forEach((palette, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ball-color-button";
    button.title = palette.name;
    button.setAttribute("aria-label", "Set ball color to " + palette.name);
    button.style.background = `radial-gradient(circle at 32% 25%, ${palette.top}, ${palette.mid} 45%, ${palette.low} 72%, ${palette.edge})`;
    button.addEventListener("click", () => setBallColor(index));
    holder.appendChild(button);
  });

  updateBallColorButtons();
}

function updateBallColorButtons() {
  const buttons = document.querySelectorAll(".ball-color-button");
  buttons.forEach((button, index) => {
    button.classList.toggle("selected", index === selectedBallColor);
  });
}

function initAudio() {
  if (!soundEnabled) return;

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  ensureUniversalReverb();
}

function makeUniversalReverbImpulse(seconds = 1.45, decay = 2.35) {
  if (!audioCtx) return null;

  const sampleRate = audioCtx.sampleRate;
  const length = Math.floor(sampleRate * seconds);
  const buffer = audioCtx.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const early = Math.sin(i * 0.017 + channel) * 0.12;
      const noise = Math.random() * 2 - 1;
      data[i] = (noise * 0.72 + early) * Math.pow(1 - t, decay);
    }
  }

  return buffer;
}

function ensureUniversalReverb() {
  if (!audioCtx || universalReverbInput) return universalReverbInput;

  universalReverbInput = audioCtx.createGain();
  universalReverbDelay = audioCtx.createDelay(0.7);
  universalReverbFeedback = audioCtx.createGain();
  universalReverbFilter = audioCtx.createBiquadFilter();
  universalReverbWet = audioCtx.createGain();

  universalReverbInput.gain.value = 1;
  universalReverbDelay.delayTime.value = 0.095;
  universalReverbFeedback.gain.value = 0.28;
  universalReverbFilter.type = "lowpass";
  universalReverbFilter.frequency.value = 1650;
  universalReverbFilter.Q.value = 0.35;
  universalReverbWet.gain.value = 0.22;

  universalReverbInput.connect(universalReverbDelay);
  universalReverbDelay.connect(universalReverbFilter);
  universalReverbFilter.connect(universalReverbWet);
  universalReverbWet.connect(audioCtx.destination);
  universalReverbFilter.connect(universalReverbFeedback);
  universalReverbFeedback.connect(universalReverbDelay);

  return universalReverbInput;
}

function connectWithOptionalReverb(source, destination, useReverb = true) {
  if (!audioCtx || !source) return;

  if (destination) {
    source.connect(destination);
    return;
  }

  source.connect(audioCtx.destination);

  if (useReverb) {
    const reverb = ensureUniversalReverb();
    if (reverb) source.connect(reverb);
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  const button = document.getElementById("soundButton");
  if (button) button.textContent = soundEnabled ? "Sound: On" : "Sound: Off";

  if (!soundEnabled) {
    stopRollLoop();
    stopPinsetterWhirl();
  } else {
    initAudio();
  }
}

function makeRumbleBuffer() {
  if (!audioCtx) return null;

  const length = audioCtx.sampleRate * 2;
  const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;

  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.035 * white) / 1.035;
    data[i] = last * 3.2;
  }

  return buffer;
}

function startRollLoop() {
  if (!soundEnabled) return;
  initAudio();
  if (!audioCtx || rollingOsc) return;

  if (!rollingRumbleBuffer) {
    rollingRumbleBuffer = makeRumbleBuffer();
  }

  rollingOsc = audioCtx.createBufferSource();
  rollingGain = audioCtx.createGain();
  rollingFilter = audioCtx.createBiquadFilter();

  rollingOsc.buffer = rollingRumbleBuffer;
  rollingOsc.loop = true;
  rollingOsc.playbackRate.value = 0.8;

  rollingFilter.type = "lowpass";
  rollingFilter.frequency.value = 95;
  rollingFilter.Q.value = 0.85;
  rollingGain.gain.value = 0.0001;

  rollingOsc.connect(rollingFilter);
  rollingFilter.connect(rollingGain);
  connectWithOptionalReverb(rollingGain, null, true);
  rollingOsc.start();
}

function updateRollLoop() {
  if (!audioCtx || !rollingOsc || !rollingGain || !ball) return;

  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  const targetVolume = ball.moving && !ball.inPit ? clamp(speed / 26, 0, 0.24) : 0;
  const targetFilter = 75 + speed * 22;
  const targetRate = clamp(0.68 + speed * 0.035, 0.65, 1.45);
  const now = audioCtx.currentTime;

  rollingOsc.playbackRate.setTargetAtTime(targetRate, now, 0.08);
  rollingFilter.frequency.setTargetAtTime(targetFilter, now, 0.08);
  rollingGain.gain.setTargetAtTime(targetVolume, now, 0.1);
}

function stopRollLoop() {
  if (!audioCtx || !rollingOsc || !rollingGain) return;

  const oldOsc = rollingOsc;
  const oldGain = rollingGain;
  const oldFilter = rollingFilter;
  const now = audioCtx.currentTime;

  oldGain.gain.cancelScheduledValues(now);
  oldGain.gain.setTargetAtTime(0.0001, now, 0.04);

  setTimeout(() => {
    try { oldOsc.stop(); } catch (e) {}
    try { oldOsc.disconnect(); } catch (e) {}
    try { oldGain.disconnect(); } catch (e) {}
    try { oldFilter.disconnect(); } catch (e) {}
  }, 170);

  rollingOsc = null;
  rollingGain = null;
  rollingFilter = null;
}


function startPinsetterWhirl() {
  if (!soundEnabled) return;
  initAudio();
  if (!audioCtx || pinsetterOsc) return;

  pinsetterOsc = audioCtx.createOscillator();
  pinsetterGain = audioCtx.createGain();
  pinsetterFilter = audioCtx.createBiquadFilter();
  pinsetterLfo = audioCtx.createOscillator();
  pinsetterLfoGain = audioCtx.createGain();

  const now = audioCtx.currentTime;

  pinsetterOsc.type = "sawtooth";
  pinsetterOsc.frequency.setValueAtTime(96, now);

  pinsetterFilter.type = "bandpass";
  pinsetterFilter.frequency.setValueAtTime(360, now);
  pinsetterFilter.Q.setValueAtTime(1.25, now);

  pinsetterLfo.type = "triangle";
  pinsetterLfo.frequency.setValueAtTime(15, now);
  pinsetterLfoGain.gain.setValueAtTime(36, now);
  pinsetterLfo.connect(pinsetterLfoGain);
  pinsetterLfoGain.connect(pinsetterFilter.frequency);

  pinsetterGain.gain.setValueAtTime(0.0001, now);
  pinsetterGain.gain.exponentialRampToValueAtTime(0.055, now + 0.08);

  pinsetterOsc.connect(pinsetterFilter);
  pinsetterFilter.connect(pinsetterGain);
  connectWithOptionalReverb(pinsetterGain, null, true);

  pinsetterOsc.start(now);
  pinsetterLfo.start(now);
}

function updatePinsetterWhirl() {
  if (!audioCtx || !pinsetterOsc || !pinsetterGain || !pinMachine.active) return;

  const t = pinMachine.timer / pinMachine.duration;
  const sweep = Math.sin(t * Math.PI);
  const now = audioCtx.currentTime;

  pinsetterOsc.frequency.setTargetAtTime(84 + sweep * 48, now, 0.05);
  pinsetterFilter.frequency.setTargetAtTime(300 + sweep * 240, now, 0.05);
  pinsetterGain.gain.setTargetAtTime(0.035 + sweep * 0.035, now, 0.06);
}

function stopPinsetterWhirl() {
  if (!audioCtx || !pinsetterOsc || !pinsetterGain) return;

  const oldOsc = pinsetterOsc;
  const oldGain = pinsetterGain;
  const oldFilter = pinsetterFilter;
  const oldLfo = pinsetterLfo;
  const oldLfoGain = pinsetterLfoGain;
  const now = audioCtx.currentTime;

  oldGain.gain.cancelScheduledValues(now);
  oldGain.gain.setTargetAtTime(0.0001, now, 0.05);

  setTimeout(() => {
    try { oldOsc.stop(); } catch (e) {}
    try { oldLfo.stop(); } catch (e) {}
    try { oldOsc.disconnect(); } catch (e) {}
    try { oldGain.disconnect(); } catch (e) {}
    try { oldFilter.disconnect(); } catch (e) {}
    try { oldLfo.disconnect(); } catch (e) {}
    try { oldLfoGain.disconnect(); } catch (e) {}
  }, 190);

  pinsetterOsc = null;
  pinsetterGain = null;
  pinsetterFilter = null;
  pinsetterLfo = null;
  pinsetterLfoGain = null;
}

function playTone(freq, duration = 0.12, volume = 0.08, type = "sine", slideTo = null, destination = null) {
  if (!soundEnabled) return;
  initAudio();
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  const out = destination || audioCtx.destination;

  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, freq), now);
  if (slideTo !== null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), now + duration);
  }

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  connectWithOptionalReverb(gain, out, destination === null);
  osc.start(now);
  osc.stop(now + duration + 0.04);
}

function playNoiseBurst(duration = 0.12, volume = 0.18, filterFreq = 1200, filterType = "bandpass", q = 0.9, destination = null) {
  if (!soundEnabled) return;
  initAudio();
  if (!audioCtx) return;

  const sampleRate = audioCtx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;

  for (let i = 0; i < length; i++) {
    const fade = Math.pow(1 - i / length, 1.7);
    const white = Math.random() * 2 - 1;
    last = last * 0.62 + white * 0.38;
    data[i] = last * fade;
  }

  const source = audioCtx.createBufferSource();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  const out = destination || audioCtx.destination;

  filter.type = filterType;
  filter.frequency.value = filterFreq;
  filter.Q.value = q;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  connectWithOptionalReverb(gain, out, destination === null);
  source.start(now);
}

function holdAudioNode(nodeBundle, ms = 1800) {
  activeSfxTails.push(nodeBundle);

  setTimeout(() => {
    activeSfxTails = activeSfxTails.filter(item => item !== nodeBundle);
  }, ms);
}

function createSfxBus(volume = 1, pan = 0, useReverb = true) {
  if (!soundEnabled) return null;
  initAudio();
  if (!audioCtx) return null;

  const master = audioCtx.createGain();
  master.gain.value = volume;

  let finalNode = master;

  if (audioCtx.createStereoPanner) {
    const panner = audioCtx.createStereoPanner();
    panner.pan.value = clamp(pan, -0.8, 0.8);
    master.connect(panner);
    finalNode = panner;
  }

  connectWithOptionalReverb(finalNode, null, useReverb);

  return master;
}

function createEchoBus(volume = 0.4, pan = 0, delayTime = 0.16, feedbackAmount = 0.36) {
  if (!soundEnabled) return null;
  initAudio();
  if (!audioCtx) return null;

  const input = audioCtx.createGain();
  const delay = audioCtx.createDelay(1.4);
  const feedback = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  const output = createSfxBus(volume, pan);
  if (!output) return null;

  input.gain.value = 1;
  delay.delayTime.value = delayTime;
  feedback.gain.value = feedbackAmount;
  filter.type = "lowpass";
  filter.frequency.value = 1850;
  filter.Q.value = 0.42;

  input.connect(delay);
  delay.connect(filter);
  filter.connect(output);
  filter.connect(feedback);
  feedback.connect(delay);

  // Keep the echo network alive long enough that pin crashes can decay naturally
  // even if the roll immediately ends and the pinsetter starts.
  holdAudioNode({ input, delay, feedback, filter, output }, 2600);

  return input;
}

function playPinClash(speed = 1) {
  if (audioFrame - lastClashFrame < 4) return;
  lastClashFrame = audioFrame;

  const power = clamp(speed / 13, 0.25, 1);
  const pan = ball ? clamp((ball.x - canvas.width / 2) / 260, -0.65, 0.65) : 0;
  const bus = createSfxBus(1.14 + power * 0.44, pan);
  const echoBus = createEchoBus(0.42 + power * 0.34, pan, 0.13 + power * 0.075, 0.34 + power * 0.16);
  if (!bus) return;

  // Body impact: louder ceramic/wood clack with a low knock underneath.
  playNoiseBurst(0.052 + power * 0.052, 0.18 + power * 0.25, 660 + power * 560, "bandpass", 1.55, bus);
  playTone(112 + power * 64, 0.10 + power * 0.05, 0.034 + power * 0.05, "triangle", 64, bus);

  // Short room slapback makes the strike feel bigger without needing external audio files.
  if (echoBus) {
    playNoiseBurst(0.07 + power * 0.055, 0.18 + power * 0.18, 850 + power * 700, "bandpass", 0.95, echoBus);
    playTone(155 + power * 80, 0.14 + power * 0.06, 0.03 + power * 0.028, "triangle", 90, echoBus);
  }

  // Bright pin scatter: several tiny ceramic-like clicks with randomized timing.
  const clickCount = Math.floor(3 + power * 6);
  for (let i = 0; i < clickCount; i++) {
    setTimeout(() => {
      const clickBus = createSfxBus(0.62 + power * 0.24, pan + (Math.random() - 0.5) * 0.42);
      const clickEcho = createEchoBus(0.18 + power * 0.16, pan + (Math.random() - 0.5) * 0.45, 0.105 + Math.random() * 0.09, 0.24);
      if (!clickBus) return;
      playNoiseBurst(0.018 + Math.random() * 0.025, 0.058 + power * 0.072, 1800 + Math.random() * 2500, "highpass", 0.72, clickBus);
      playTone(540 + Math.random() * 480, 0.03 + Math.random() * 0.025, 0.015 + power * 0.023, "triangle", 260 + Math.random() * 220, clickBus);
      if (clickEcho) playNoiseBurst(0.018 + Math.random() * 0.02, 0.03 + power * 0.04, 1500 + Math.random() * 1800, "bandpass", 0.7, clickEcho);
    }, 8 + i * (16 + Math.random() * 20));
  }

  // Stronger hits get one satisfying rack rattle.
  if (power > 0.55) {
    setTimeout(() => playNoiseBurst(0.16, 0.078 + power * 0.078, 1050 + power * 720, "bandpass", 0.55, bus), 66);
    if (echoBus) setTimeout(() => playNoiseBurst(0.18, 0.055 + power * 0.08, 900 + power * 520, "bandpass", 0.65, echoBus), 120);
  }
}

function playPitThunk() {
  const bus = createSfxBus(0.85, 0);
  if (!bus) return;
  playTone(78, 0.18, 0.085, "triangle", 42, bus);
  playNoiseBurst(0.105, 0.075, 360, "lowpass", 0.8, bus);
  setTimeout(() => playNoiseBurst(0.055, 0.035, 900, "bandpass", 1.0, bus), 65);
}

function playChord(notes, duration = 0.12, volume = 0.045, type = "triangle", delayStep = 0, destination = null) {
  notes.forEach((note, i) => {
    setTimeout(() => playTone(note, duration, volume, type, null, destination), i * delayStep);
  });
}

function playMessageSfx(text, shake = false) {
  const big = text.includes("STRIKE") || text.includes("TURKEY") || text.includes("DOUBLE") || text.includes("PERFECT");
  const spare = text.includes("SPARE");
  const gutter = text.includes("GUTTER");
  const gameOverText = text.includes("GAME OVER");

  if (big) {
    const bus = createSfxBus(1.42, 0, false);
    if (!bus) return;

    // Arcade-major flourish with a quick sparkle tail.
    playChord([392, 523.25, 659.25], 0.15, 0.066, "triangle", 0, bus);
    setTimeout(() => playChord([523.25, 659.25, 783.99], 0.16, 0.075, "triangle", 0, bus), 95);
    setTimeout(() => playTone(1046.5, 0.18, 0.073, "sine", 1396.9, bus), 190);

    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        const sparkleBus = createSfxBus(0.9, (Math.random() - 0.5) * 0.75, false);
        playTone(900 + Math.random() * 900, 0.035, 0.018, "sine", 1400 + Math.random() * 900, sparkleBus);
      }, 210 + i * 28);
    }

    if (shake) setTimeout(() => playNoiseBurst(0.11, 0.115, 1500, "bandpass", 0.8, bus), 35);
  } else if (spare) {
    const bus = createSfxBus(1.22, 0, false);
    if (!bus) return;
    playTone(329.63, 0.08, 0.062, "triangle", 392, bus);
    setTimeout(() => playTone(493.88, 0.095, 0.064, "triangle", 587.33, bus), 75);
    setTimeout(() => playTone(739.99, 0.12, 0.058, "sine", 880, bus), 155);
  } else if (gutter) {
    const bus = createSfxBus(1.22, 0, false);
    if (!bus) return;
    playTone(185, 0.18, 0.078, "triangle", 92, bus);
    setTimeout(() => playNoiseBurst(0.12, 0.057, 280, "lowpass", 0.9, bus), 40);
  } else if (gameOverText) {
    const bus = createSfxBus(1.22, 0, false);
    if (!bus) return;
    playTone(392, 0.1, 0.054, "triangle", 349.23, bus);
    setTimeout(() => playTone(329.63, 0.12, 0.052, "triangle", 293.66, bus), 105);
    setTimeout(() => playTone(261.63, 0.2, 0.056, "triangle", 196, bus), 230);
  } else {
    const bus = createSfxBus(1.05, 0, false);
    if (!bus) return;
    playTone(440, 0.06, 0.041, "triangle", 554.37, bus);
    setTimeout(() => playTone(659.25, 0.065, 0.036, "sine", 740, bus), 65);
  }
}

const lane = {
  left: 110,
  right: 390,
  top: 70,
  bottom: 748
};

const gutters = {
  left: { x: 55, width: 55 },
  right: { x: 390, width: 55 }
};

const pit = {
  left: 55,
  right: 445,
  top: 35,
  bottom: 88
};

const laneAssist = {
  minForwardSpeed: 3.65,
  maxBoostedSpeed: 4.85,
  pull: -0.032
};

const releaseZone = {
  top: 610,
  bottom: 742
};

const camera = {
  horizonY: 104,
  bottomY: 748,
  topLaneLeft: 180,
  topLaneRight: 320,
  bottomLaneLeft: 76,
  bottomLaneRight: 424,
  topGutterOuterLeft: 140,
  topGutterOuterRight: 360,
  bottomGutterOuterLeft: 14,
  bottomGutterOuterRight: 486
};
function lerp(a,b,t){ return a+(b-a)*t; }
function perspectiveT(y){ return clamp((y-lane.top)/(lane.bottom-lane.top),0,1); }
function perspectiveEase(y){ return Math.pow(perspectiveT(y),1.22); }
function screenYFromWorld(y){ const t=perspectiveT(y); return camera.horizonY+Math.pow(t,0.78)*(camera.bottomY-camera.horizonY); }
function laneScreenLeft(y){ return lerp(camera.topLaneLeft,camera.bottomLaneLeft,perspectiveEase(y)); }
function laneScreenRight(y){ return lerp(camera.topLaneRight,camera.bottomLaneRight,perspectiveEase(y)); }
function gutterOuterLeft(y){ return lerp(camera.topGutterOuterLeft,camera.bottomGutterOuterLeft,perspectiveEase(y)); }
function gutterOuterRight(y){ return lerp(camera.topGutterOuterRight,camera.bottomGutterOuterRight,perspectiveEase(y)); }
function worldToScreen(x,y){ const l=laneScreenLeft(y), r=laneScreenRight(y); const n=(x-lane.left)/(lane.right-lane.left); return {x:l+n*(r-l), y:screenYFromWorld(y)}; }
function screenScale(y){ return lerp(0.48,1.22,perspectiveEase(y)); }
function ballScreenScale(y){ return lerp(0.56,1.16,perspectiveEase(y)); }
function pinScreenScale(y){
  // Match the ball depth behavior so pins grow/shrink with distance in the same perspective language.
  return ballScreenScale(y) * 0.92;
}
function fallenPinScreenScale(y){
  return ballScreenScale(y) * 0.88;
}
function screenToWorld(x,y){ let lo=lane.top, hi=lane.bottom; for(let i=0;i<24;i++){ const m=(lo+hi)/2; if(screenYFromWorld(m)<y) lo=m; else hi=m; } const wy=(lo+hi)/2; const l=laneScreenLeft(wy), r=laneScreenRight(wy); const n=(x-l)/(r-l); return {x:lane.left+n*(lane.right-lane.left), y:wy}; }
function strokeWorldLine(x1,y1,x2,y2){ const a=worldToScreen(x1,y1), b=worldToScreen(x2,y2); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
function fillWorldQuad(x1,y1,x2,y2,fill){ ctx.fillStyle=fill; const a=worldToScreen(x1,y1), b=worldToScreen(x2,y1), c=worldToScreen(x2,y2), d=worldToScreen(x1,y2); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.lineTo(c.x,c.y); ctx.lineTo(d.x,d.y); ctx.closePath(); ctx.fill(); }
function pinHitR(pin){ return pin.hitR || pin.r || 10.5; }


function createBall() {
  ball = {
    x: 250,
    y: 690,
    r: 18,
    vx: 0,
    vy: 0,
    moving: false,
    inGutter: false,
    inPit: false,
    rotation: -0.35,
    spinPulse: 0,
    releasePower: 0,
    driftForce: 0,
    driftLife: 0
  };
}

function createPins() {
  pins = [];
  const startX = 250;
  const headPinY = 238;
  const rowGapY = 34;
  const gapX = 43;

  // In the perspective view the head pin sits closest to the player,
  // while the wider rows recede toward the back pit.
  const layout = [
    [0],
    [-0.5, 0.5],
    [-1, 0, 1],
    [-1.5, -0.5, 0.5, 1.5]
  ];

  for (let row = 0; row < layout.length; row++) {
    for (let col = 0; col < layout[row].length; col++) {
      pins.push({
        x: startX + layout[row][col] * gapX,
        y: headPinY - row * rowGapY,
        r: 10.8,
        hitR: 9.2,
        vx: 0,
        vy: 0,
        standing: true,
        knocked: false,
        inGutter: false,
        inPit: false,
        fallAngle: -Math.PI / 2,
        angleWobble: (Math.random() - 0.5) * 0.10,
        spriteTilt: 0
      });
    }
  }
}

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  return screenToWorld(p.clientX - rect.left, p.clientY - rect.top);
}

canvas.addEventListener("mousedown", startDrag);
canvas.addEventListener("mousemove", dragMove);
canvas.addEventListener("mouseup", releaseBall);

canvas.addEventListener("touchstart", startDrag);
canvas.addEventListener("touchmove", dragMove);
canvas.addEventListener("touchend", releaseBall);

function startDrag(e) {
  initAudio();
  if (!gameStarted || replayMode || gameOver || waitingForNextRoll || ball.moving) return;
  if (!canCurrentClientRoll()) return;
  e.preventDefault();

  const pos = pointerPos(e);
  const insideReleaseZone =
    pos.x >= lane.left + ball.r &&
    pos.x <= lane.right - ball.r &&
    pos.y >= releaseZone.top + ball.r &&
    pos.y <= releaseZone.bottom;

  const dx = pos.x - ball.x;
  const dy = pos.y - ball.y;
  const grabbedBall = Math.sqrt(dx * dx + dy * dy) <= ball.r + 20;

  if (insideReleaseZone || grabbedBall) {
    ball.x = clamp(pos.x, lane.left + ball.r, lane.right - ball.r);
    ball.y = clamp(pos.y, releaseZone.top + ball.r, releaseZone.bottom);

    dragging = true;
    dragStart = { x: ball.x, y: ball.y };
    dragCurrent = { x: ball.x, y: ball.y };
  }
}

function dragMove(e) {
  if (!dragging) return;
  e.preventDefault();

  const pos = pointerPos(e);
  dragCurrent = pos;

  ball.x = clamp(pos.x, lane.left + ball.r, lane.right - ball.r);
  ball.y = clamp(pos.y, releaseZone.top + ball.r, releaseZone.bottom);
}

function releaseBall() {
  if (!dragging) return;

  dragging = false;

  const dx = dragStart.x - dragCurrent.x;
  const dy = dragStart.y - dragCurrent.y;

  ball.vx = dx * 0.103;
  ball.vy = dy * 0.155 - 6.15;

  if (ball.vy > -3.05) ball.vy = -3.05;
  clampBallVelocity(11.4);

  const rollPower = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  const weakRollBias = clamp(1 - (rollPower - 4) / 13, 0, 1);
  const randomLean = Math.random() < 0.5 ? -1 : 1;

  ball.releasePower = rollPower;
  ball.driftForce = randomLean * lerp(0.003, 0.028, weakRollBias);
  ball.driftLife = lerp(0.5, 1.08, weakRollBias);

  ball.moving = true;
  rollTimer = 0;
  startRollLoop();
  emitOnlineRollReplayStart();
}

function update() {
  audioFrame++;
  updatePinMachine();
  if (ball.moving) {
    rollTimer++;

    if (!ball.inGutter && !ball.inPit) {
      const forwardSpeed = Math.abs(ball.vy);
      const abnormallyWeak = forwardSpeed < laneAssist.minForwardSpeed;
      const underAssistCap = forwardSpeed < laneAssist.maxBoostedSpeed;

      if (abnormallyWeak && underAssistCap) {
        ball.vy += laneAssist.pull;
      }
    }

    if (!ball.inGutter && !ball.inPit && ball.driftLife > 0) {
      const forwardSpeed = Math.abs(ball.vy);
      const powerSteadying = clamp(forwardSpeed / 15, 0, 1);
      ball.vx += ball.driftForce * (1 - powerSteadying * 0.62) * ball.driftLife;
      ball.driftLife *= 0.992;
    }

    ball.x += ball.vx;
    ball.y += ball.vy;

    updateBallSpin();

    ball.vx *= 0.987;
    ball.vy *= 0.997;
    clampBallVelocity(11.7);
    updateRollLoop();

    checkGutters();

    if (!ball.inPit && !ball.inGutter) {
      if (ball.x - ball.r < lane.left || ball.x + ball.r > lane.right) {
        enterGutter();
      }

      checkBallPinCollisions();
    }

    checkBallPit();

    updatePins();
    checkPinPinCollisions();

    if ((ball.inPit || ball.y < 25) && (pinsAreSettled() || rollTimer > maxRollTime)) {
      forceSettlePins();
      if (replayMode) {
        replayMode = false;
        ball.moving = false;
        waitingForNextRoll = false;
        stopRollLoop();
      } else {
        finishRoll();
      }
    }
  }
}


function updateBallSpin() {
  if (ball.inPit) return;

  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  if (speed < 0.02) return;

  const travelDirection = ball.vy <= 0 ? 1 : -1;
  const sideSpin = ball.vx * 0.018;

  ball.rotation += travelDirection * (speed / ball.r) + sideSpin;
  ball.spinPulse = Math.min(1, speed / 16);
}

function checkBallPit() {
  if (ball.inPit) return;

  // Let the ball travel visually into the recessed back pit before the rear wall stops it.
  if (ball.y - ball.r <= pit.top) {
    enterBallPit();
  }
}

function enterBallPit() {
  playPitThunk();
  stopRollLoop();
  ball.inPit = true;
  ball.inGutter = false;
  ball.y = pit.top + ball.r;
  ball.x = clamp(ball.x, pit.left + ball.r, pit.right - ball.r);
  ball.vx = 0;
  ball.vy = 0;
}

function updatePins() {
  for (const pin of pins) {
    if (!pin.knocked) continue;

    pin.x += pin.vx;
    pin.y += pin.vy;

    if (!pin.inPit && pin.y - pinHitR(pin) <= pit.bottom) {
      enterPit(pin);
    }

    if (pin.inPit) {
      updatePitPin(pin);
      continue;
    }

    pin.inGutter = pin.x + pin.r < lane.left || pin.x - pin.r > lane.right;

    pin.vx *= pin.inGutter ? 0.963 : 0.945;
    pin.vy *= pin.inGutter ? 0.963 : 0.945;

    if (Math.abs(pin.vx) < 0.03) pin.vx = 0;
    if (Math.abs(pin.vy) < 0.03) pin.vy = 0;

    if (pin.x - pinHitR(pin) < pit.left) {
      pin.x = pit.left + pinHitR(pin);
      pin.vx *= -0.28;
    }

    if (pin.x + pinHitR(pin) > pit.right) {
      pin.x = pit.right - pinHitR(pin);
      pin.vx *= -0.28;
    }

    if (pin.y + pinHitR(pin) > lane.bottom) {
      pin.y = lane.bottom - pinHitR(pin);
      pin.vy *= -0.28;
    }
  }
}

function enterPit(pin) {
  pin.inPit = true;
  pin.inGutter = false;
  pin.standing = false;
  pin.knocked = true;

  pin.y = clamp(pin.y, pit.top + pinHitR(pin), pit.bottom - pinHitR(pin));
  pin.x = clamp(pin.x, pit.left + pinHitR(pin), pit.right - pinHitR(pin));

  pin.vx *= 0.78;
  pin.vy *= 0.48;
}

function updatePitPin(pin) {
  pin.vx *= 0.82;
  pin.vy *= 0.82;

  if (Math.abs(pin.vx) < 0.08) pin.vx = 0;
  if (Math.abs(pin.vy) < 0.08) pin.vy = 0;

  if (pin.x - pinHitR(pin) < pit.left) {
    pin.x = pit.left + pinHitR(pin);
    pin.vx *= -0.24;
  }

  if (pin.x + pinHitR(pin) > pit.right) {
    pin.x = pit.right - pinHitR(pin);
    pin.vx *= -0.24;
  }

  if (pin.y - pinHitR(pin) < pit.top) {
    pin.y = pit.top + pinHitR(pin);
    pin.vy *= -0.24;
  }

  if (pin.y + pinHitR(pin) > pit.bottom) {
    pin.y = pit.bottom - pinHitR(pin);
    pin.vy *= -0.24;
  }
}

function checkBallPinCollisions() {
  for (const pin of pins) {
    if (!pin.standing && !pin.knocked) continue;

    const dx = pin.x - ball.x;
    const dy = pin.y - ball.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < ball.r + pinHitR(pin)) {
      const nx = dx / dist || 0;
      const ny = dy / dist || -1;

      pin.standing = false;
      pin.knocked = true;

      const ballSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      const speedKick = clamp((ballSpeed - 4) / 13, 0, 1);
      const transfer = lerp(0.34, 0.53, speedKick);
      const impactKick = lerp(1.05, 2.05, speedKick);

      // Angle shots now carry more side energy into the pin.
      // Straight shots still drive mostly forward, while diagonal shots kick pins sideways.
      const lateralRatio = Math.abs(ball.vx) / (Math.abs(ball.vy) + 0.8);
      const angleHit = clamp(lateralRatio * 1.45, 0, 1);
      const sideSign = Math.sign(ball.vx || nx || 1);
      const horizontalTransfer = transfer + angleHit * 0.24;
      const horizontalKick = impactKick * lerp(0.72, 1.38, angleHit);
      const forwardTransfer = transfer * lerp(1, 0.82, angleHit);
      const forwardKick = impactKick * lerp(1, 0.78, angleHit);
      const angleSideKick = sideSign * ballSpeed * lerp(0.02, 0.16, angleHit) * lerp(0.45, 1, speedKick);
      const pinAngleDrift = (Math.random() - 0.5) * lerp(0.18, 0.34, speedKick);
      pin.fallAngle = Math.atan2(ball.vy + ny * forwardKick, ball.vx + nx * horizontalKick + angleSideKick) + pinAngleDrift;
      pin.angleWobble = pinAngleDrift;

      pin.vx += ball.vx * horizontalTransfer + nx * horizontalKick + angleSideKick;
      pin.vy += ball.vy * forwardTransfer + ny * forwardKick;

      playPinClash(ballSpeed);

      ball.vx *= 0.88;
      ball.vy *= 0.9;

      separateObjects(ball, pin, ball.r + pinHitR(pin));
    }
  }
}

function checkPinPinCollisions() {
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const a = pins[i];
      const b = pins[j];

      if (!a.knocked && !b.knocked) continue;
      if ((a.inGutter || b.inGutter) && !(a.inPit && b.inPit)) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = pinHitR(a) + pinHitR(b);

      if (dist < minDist) {
        const nx = dx / dist || 1;
        const ny = dy / dist || 0;

        const speedA = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
        const speedB = Math.sqrt(b.vx * b.vx + b.vy * b.vy);

        const impactSpeed = Math.max(speedA, speedB);
        const knockChainThreshold = 0.68;

        const push = (minDist - dist) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;

        if (impactSpeed > knockChainThreshold) {
          a.standing = false;
          b.standing = false;
          a.knocked = true;
          b.knocked = true;
          playPinClash(impactSpeed);
        } else if (a.standing || b.standing) {
          if (a.knocked) {
            a.vx *= -0.12;
            a.vy *= -0.12;
          }
          if (b.knocked) {
            b.vx *= -0.12;
            b.vy *= -0.12;
          }
          continue;
        }

        const avx = a.vx;
        const avy = a.vy;

        const relativeSide = Math.abs(avx - b.vx);
        const relativeForward = Math.abs(avy - b.vy);
        const sideCollision = clamp(relativeSide / (relativeForward + 0.7), 0, 1);
        const sideBoost = lerp(1, 1.22, sideCollision);
        const forwardDampen = lerp(1, 0.9, sideCollision);

        a.vx = (b.vx * 0.50 - nx * 0.16) * sideBoost;
        a.vy = (b.vy * 0.50 - ny * 0.16) * forwardDampen;

        b.vx = (avx * 0.50 + nx * 0.16) * sideBoost;
        b.vy = (avy * 0.50 + ny * 0.16) * forwardDampen;

        if (impactSpeed > knockChainThreshold) {
          a.angleWobble = (Math.random() - 0.5) * 0.22;
          b.angleWobble = (Math.random() - 0.5) * 0.22;
        }
      }
    }
  }
}

function separateObjects(a, b, minDist) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const overlap = minDist - dist;

  if (overlap > 0) {
    const nx = dx / dist;
    const ny = dy / dist;

    b.x += nx * overlap;
    b.y += ny * overlap;
  }
}

function pinsAreSettled() {
  for (const pin of pins) {
    if (!pin.knocked) continue;

    if (Math.abs(pin.vx) > 0.12 || Math.abs(pin.vy) > 0.12) {
      return false;
    }
  }

  return true;
}

function forceSettlePins() {
  for (const pin of pins) {
    if (!pin.knocked) continue;

    if (pin.inPit) {
      pin.x = clamp(pin.x, pit.left + pinHitR(pin), pit.right - pinHitR(pin));
      pin.y = clamp(pin.y, pit.top + pinHitR(pin), pit.bottom - pinHitR(pin));
    }

    pin.vx = 0;
    pin.vy = 0;
  }
}

function checkGutters() {
  if (ball.inGutter) return;

  if (ball.x - ball.r <= lane.left || ball.x + ball.r >= lane.right) {
    enterGutter();
  }
}

function enterGutter() {
  ball.inGutter = true;

  if (ball.x < canvas.width / 2) {
    ball.x = gutters.left.x + gutters.left.width / 2;
  } else {
    ball.x = gutters.right.x + gutters.right.width / 2;
  }

  ball.vx = 0;
  ball.vy = Math.min(ball.vy, -5);
}

function finishRoll() {
  stopRollLoop();
  ball.moving = false;

  let knockedThisRoll = 0;

  if (!ball.inGutter) {
    const standingNow = pins.filter(p => p.standing).length;
    knockedThisRoll = pinsStandingBeforeRoll - standingNow;
  }

  const messageFrame = frame;
  const messageRoll = rollInFrame;
  const messageStandingBefore = pinsStandingBeforeRoll;
  const messageWasGutter = ball.inGutter;

  rolls.push(knockedThisRoll);
  evaluateRollMessage(knockedThisRoll, messageStandingBefore, messageRoll, messageFrame, messageWasGutter);
  emitOnlineRollReplayEnd(knockedThisRoll, messageWasGutter);

  if (frame >= 10) {
    handleTenthFrame();
    return;
  }

  if (rollInFrame === 1 && knockedThisRoll === 10) {
    frame++;
    rollInFrame = 1;
    pinsStandingBeforeRoll = 10;
    waitingForNextRoll = true;
    pendingTurnChange = multiplayerMode;
    saveCurrentPlayerState();
    setTimeout(() => beginPinMachineReset("frame"), 650);
  } else if (rollInFrame === 1) {
    rollInFrame = 2;
    pinsStandingBeforeRoll = pins.filter(p => p.standing).length;
    waitingForNextRoll = true;
    pendingTurnChange = false;
    saveCurrentPlayerState();
    setTimeout(() => beginPinMachineReset("roll"), 650);
  } else {
    frame++;
    rollInFrame = 1;
    pinsStandingBeforeRoll = 10;
    waitingForNextRoll = true;
    pendingTurnChange = multiplayerMode;
    saveCurrentPlayerState();
    setTimeout(() => beginPinMachineReset("frame"), 650);
  }

  updateHud();
  if (onlineMode && !pendingTurnChange) emitOnlineState();
}

function beginPinMachineReset(mode = "frame") {
  if (gameOver) return;

  pinMachine = {
    active: true,
    timer: 0,
    duration: mode === "frame" ? 118 : 92,
    mode,
    didSwitch: false
  };

  startPinsetterWhirl();
}


function updatePinMachine() {
  if (!pinMachine.active) return;

  pinMachine.timer++;
  updatePinsetterWhirl();
  const t = pinMachine.timer / pinMachine.duration;
  const sweepY = getSweepWorldY();

  for (const pin of pins) {
    if (!pin.standing || pin.inPit) {
      if (pin.y <= sweepY + 18) {
        pin.inPit = true;
        pin.x = clamp(pin.x, pit.left + pinHitR(pin), pit.right - pinHitR(pin));
        pin.y = clamp(pit.top + 10 + Math.random() * 28, pit.top + pinHitR(pin), pit.bottom - pinHitR(pin));
        pin.vx = 0;
        pin.vy = 0;
      }
    }
  }

  if (!pinMachine.didSwitch && t >= 0.52) {
    pinMachine.didSwitch = true;

    if (pinMachine.mode === "frame") {
      createPins();
      for (const pin of pins) {
        pin.deploy = 1;
      }
    } else {
      pins = pins.filter(pin => pin.standing);
    }

    createBall();
  }

  if (pinMachine.didSwitch) {
    for (const pin of pins) {
      if (pin.deploy > 0) {
        pin.deploy = Math.max(0, pin.deploy - 0.045);
      }
    }
  }

  if (pinMachine.timer >= pinMachine.duration) {
    pinMachine.active = false;
    waitingForNextRoll = false;
    stopPinsetterWhirl();
    if (pendingTurnChange) {
      setTimeout(advanceToNextPlayer, 140);
    }
  }
}

function getSweepWorldY() {
  if (!pinMachine.active) return pit.bottom;

  const t = pinMachine.timer / pinMachine.duration;
  const outAndBack = t < 0.48 ? t / 0.48 : 1 - ((t - 0.48) / 0.52);
  const eased = 1 - Math.pow(1 - clamp(outAndBack, 0, 1), 2);
  return lerp(pit.bottom + 8, 315, eased);
}

function drawPinMachine() {
  if (!pinMachine.active) return;

  const y = getSweepWorldY();
  const left = worldToScreen(lane.left - 12, y);
  const right = worldToScreen(lane.right + 12, y);
  const sc = screenScale(y);

  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(61,244,255,0.55)";
  ctx.shadowBlur = 12;

  ctx.strokeStyle = "rgba(8,10,24,0.96)";
  ctx.lineWidth = Math.max(9, 11 * sc);
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.stroke();

  ctx.strokeStyle = "rgba(61,244,255,0.88)";
  ctx.lineWidth = Math.max(2, 3 * sc);
  ctx.beginPath();
  ctx.moveTo(left.x, left.y - 3 * sc);
  ctx.lineTo(right.x, right.y - 3 * sc);
  ctx.stroke();

  ctx.restore();
}

function nextRoll() {
  createBall();
  waitingForNextRoll = false;
}

function nextFrame() {
  createBall();
  createPins();
  waitingForNextRoll = false;
}

function handleTenthFrame() {
  const tenth = getTenthFrameRolls();

  if (tenth.length === 1) {
    if (tenth[0] === 10) {
      createPins();
      pinsStandingBeforeRoll = 10;
    } else {
      pinsStandingBeforeRoll = pins.filter(p => p.standing).length;
    }

    rollInFrame = 2;
    waitingForNextRoll = true;
    pendingTurnChange = false;
    saveCurrentPlayerState();
    setTimeout(() => beginPinMachineReset(tenth[0] === 10 ? "frame" : "roll"), 650);
  } else if (tenth.length === 2) {
    if (tenth[0] === 10 || tenth[0] + tenth[1] === 10) {
      pinsStandingBeforeRoll = 10;
      rollInFrame = 3;
      waitingForNextRoll = true;
      pendingTurnChange = false;
      saveCurrentPlayerState();
      setTimeout(() => beginPinMachineReset("frame"), 650);
    } else {
      endGame();
    }
  } else {
    endGame();
  }

  updateHud();
}

function getTenthFrameRolls() {
  let index = 0;

  for (let f = 1; f < 10; f++) {
    if (rolls[index] === 10) index++;
    else index += 2;
  }

  return rolls.slice(index);
}

function calculateScore() {
  let score = 0;
  let index = 0;

  for (let f = 1; f <= 10; f++) {
    if (rolls[index] === undefined) break;

    if (rolls[index] === 10) {
      if (rolls[index + 1] === undefined || rolls[index + 2] === undefined) break;
      score += 10 + rolls[index + 1] + rolls[index + 2];
      index++;
    } else {
      const a = rolls[index];
      const b = rolls[index + 1];

      if (b === undefined) break;

      if (a + b === 10) {
        if (rolls[index + 2] === undefined) break;
        score += 10 + rolls[index + 2];
      } else {
        score += a + b;
      }

      index += 2;
    }
  }

  return score;
}


function getRankedResults() {
  return players
    .map((player, index) => ({
      name: player.name,
      score: scoreFromRolls(player.rolls),
      colorIndex: player.colorIndex,
      originalIndex: index,
      wins: Number(matchWinCounts[index] || 0)
    }))
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
}

function countLocalGameWinnerIfNeeded() {
  if (onlineMode || finalWinCountedLocal || !multiplayerMode || !allPlayersFinished()) return;
  const results = getRankedResults();
  if (!results.length) return;
  const winnerIndex = results[0].originalIndex;
  while (matchWinCounts.length < players.length) matchWinCounts.push(0);
  matchWinCounts[winnerIndex] = (matchWinCounts[winnerIndex] || 0) + 1;
  finalWinCountedLocal = true;
}

function endGame() {
  stopRollLoop();
  gameOver = true;
  waitingForNextRoll = false;
  pendingTurnChange = false;
  saveCurrentPlayerState();

  if (multiplayerMode && !allPlayersFinished()) {
    showAnnouncer(players[currentPlayerIndex].name + " Done", "Score: " + calculateScore(), 135, false);
    setTimeout(advanceToNextPlayer, 1050);
  } else {
    finalResultsReady = multiplayerMode && allPlayersFinished();
    if (finalResultsReady) {
      countLocalGameWinnerIfNeeded();
      emitOnlineState();
    }
    if (!multiplayerMode && calculateScore() === 300) {
      showAnnouncer("PERFECT GAME!", "300", 240, true);
    } else if (!multiplayerMode) {
      showAnnouncer("GAME OVER", "Final Score: " + calculateScore(), 180, false);
    }
  }

  updateHud();
  updateTurnBanner();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawLane();
  drawPins();
  drawPinMachine();
  drawBall();

  if (dragging && dragStart && dragCurrent) {
    drawAimLine();
  }

  if (gameOver) {
    drawFinalScoreScreen();
  } else {
    drawAnnouncement();
  }
}


function drawMultiplayerFinalScoreScreen() {
  const results = getRankedResults();
  const topScore = Math.max(...results.map(result => result.score));
  const champion = results[0];
  const runnerUp = results[1];
  const podiumThird = results[2];
  const winners = results.filter(result => result.score === topScore).map(result => result.name).join(" & ");
  const showPodium = results.length >= 3;

  ctx.save();
  ctx.fillStyle = "rgba(5, 1, 10, 0.84)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const glow = ctx.createRadialGradient(250, 330, 10, 250, 330, 300);
  glow.addColorStop(0, "rgba(255,211,106,0.32)");
  glow.addColorStop(0.45, "rgba(61,244,255,0.20)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(20, 10, 32, 0.94)";
  roundRect(34, 128, 432, 500, 28, true, false);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#ffd36a";
  roundRect(34, 128, 432, 500, 28, false, true);

  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(255,79,216,0.82)";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#ffd36a";
  ctx.font = "29px Bungee, Fredoka, Arial";
  ctx.fillText("FINAL RESULTS", 250, 178);

  ctx.shadowBlur = 0;
  ctx.font = "18px Fredoka, Arial";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("Champion: " + (champion ? champion.name : winners), 250, 211);
  if (runnerUp) ctx.fillText("Runner Up: " + runnerUp.name, 250, 234);
  if (podiumThird) ctx.fillText("Podium: " + podiumThird.name, 250, 257);

  if (showPodium) {
    const podium = [results[1], results[0], results[2]];
    const blocks = [
      { x: 92, y: 318, w: 96, h: 76, place: "Runner Up", medal: "🥈" },
      { x: 202, y: 276, w: 96, h: 118, place: "Champion", medal: "🥇" },
      { x: 312, y: 342, w: 96, h: 52, place: "Podium", medal: "🥉" }
    ];
    podium.forEach((result, i) => {
      if (!result) return;
      const block = blocks[i];
      const palette = ballPalettes[result.colorIndex] || ballPalettes[0];
      ctx.fillStyle = i === 1 ? "rgba(255,211,106,0.30)" : "rgba(61,244,255,0.18)";
      roundRect(block.x, block.y, block.w, block.h, 16, true, false);
      ctx.strokeStyle = i === 1 ? "#ffd36a" : "rgba(61,244,255,0.75)";
      ctx.lineWidth = 2;
      roundRect(block.x, block.y, block.w, block.h, 16, false, true);
      ctx.fillStyle = `radial-gradient(circle at 32% 25%, ${palette.top}, ${palette.mid})`;
      ctx.fillStyle = palette.mid;
      ctx.beginPath();
      ctx.arc(block.x + block.w / 2, block.y - 18, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.font = "20px Fredoka, Arial";
      ctx.fillText(block.medal, block.x + block.w / 2, block.y + 26);
      ctx.fillStyle = "#ffd36a";
      ctx.font = "bold 11px Bungee, Fredoka, Arial";
      ctx.fillText(block.place.toUpperCase(), block.x + block.w / 2, block.y + 50);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px Fredoka, Arial";
      ctx.fillText(result.name, block.x + block.w / 2, block.y + block.h - 26);
      ctx.fillStyle = "#3df4ff";
      ctx.font = "bold 19px Bungee, Fredoka, Arial";
      ctx.fillText(String(result.score), block.x + block.w / 2, block.y + block.h - 4);
    });
  }

  const listTop = showPodium ? 442 : 290;
  results.forEach((result, index) => {
    const y = listTop + index * 44;
    const isWinner = result.score === topScore;
    ctx.fillStyle = isWinner ? "rgba(255,211,106,0.22)" : "rgba(255,255,255,0.07)";
    roundRect(72, y - 25, 356, 31, 12, true, false);

    ctx.textAlign = "left";
    ctx.fillStyle = isWinner ? "#ffd36a" : "#dffaff";
    ctx.font = "bold 16px Fredoka, Arial";
    const rankLabel = index === 0 ? "Champion" : (index === 1 ? "Runner Up" : (index === 2 ? "Podium" : `${index + 1}.`));
    ctx.fillText(`${rankLabel}  ${result.name}`, 96, y - 3);
    ctx.font = "12px Fredoka, Arial";
    ctx.fillStyle = "#bfefff";
    const winText = result.wins === 1 ? "1 room win" : `${result.wins} room wins`;
    ctx.fillText(winText, 96, y + 12);

    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px Bungee, Fredoka, Arial";
    ctx.fillText(String(result.score), 402, y);
  });

  ctx.textAlign = "center";
  ctx.fillStyle = "#3df4ff";
  ctx.font = "bold 15px Fredoka, Arial";
  if (onlineMode && latestOnlineRoom) {
    const readyCount = latestOnlineRoom.players.filter(player => player.playAgainReady).length;
    ctx.fillText(`Play Again ready: ${readyCount} / ${latestOnlineRoom.players.length}`, 250, 602);
  } else {
    ctx.fillText("Reset for a rematch or exit to menu.", 250, 602);
  }
  ctx.restore();
  updatePlayAgainButton();
}

function scoreFromRolls(sourceRolls) {
  const oldRolls = rolls;
  rolls = sourceRolls.slice();
  const score = calculateScore();
  rolls = oldRolls;
  return score;
}

function drawFinalScoreScreen() {
  if (multiplayerMode && allPlayersFinished()) {
    drawMultiplayerFinalScoreScreen();
    return;
  }
  const finalScore = calculateScore();
  const perfect = finalScore === 300;
  const title = perfect ? "PERFECT GAME!" : "FINAL SCORE";
  const rating = getScoreRating(finalScore);

  ctx.save();

  ctx.fillStyle = "rgba(5, 1, 10, 0.78)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const glow = ctx.createRadialGradient(250, 340, 10, 250, 340, 250);
  glow.addColorStop(0, perfect ? "rgba(255, 211, 106, 0.34)" : "rgba(255, 79, 216, 0.26)");
  glow.addColorStop(0.45, "rgba(61, 244, 255, 0.16)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(20, 10, 32, 0.92)";
  roundRect(52, 210, 396, 340, 28, true, false);

  ctx.lineWidth = 4;
  ctx.strokeStyle = perfect ? "#ffd36a" : "#3df4ff";
  roundRect(52, 210, 396, 340, 28, false, true);

  ctx.shadowColor = perfect ? "rgba(255, 211, 106, 0.95)" : "rgba(255, 79, 216, 0.75)";
  ctx.shadowBlur = 18;
  ctx.textAlign = "center";
  ctx.fillStyle = perfect ? "#ffd36a" : "#ff4fd8";
  ctx.font = perfect ? "30px Bungee, Fredoka, Arial" : "32px Bungee, Fredoka, Arial";
  ctx.fillText(title, 250, 270);

  ctx.shadowColor = "rgba(61, 244, 255, 0.92)";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "#ffffff";
  ctx.font = "72px Bungee, Fredoka, Arial";
  ctx.fillText(finalScore, 250, 350);

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffd36a";
  ctx.font = "22px Fredoka, Arial";
  ctx.fillText(rating, 250, 392);

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(105, 420);
  ctx.lineTo(395, 420);
  ctx.stroke();

  ctx.fillStyle = "#e8d9ff";
  ctx.font = "17px Fredoka, Arial";
  ctx.fillText("Frames complete: 10 / 10", 250, 455);
  ctx.fillText("Press Reset Game to bowl again", 250, 485);

  if (perfect) {
    ctx.fillStyle = "#ffd36a";
    ctx.font = "22px Bungee, Fredoka, Arial";
    ctx.fillText("★★★★★★★★★★★★", 250, 520);
  }

  ctx.restore();
}

function getScoreRating(score) {
  if (score === 300) return "Legendary night at the lanes!";
  if (score >= 220) return "Pro-level bowling!";
  if (score >= 180) return "Great game!";
  if (score >= 140) return "Solid night out.";
  if (score >= 100) return "Respectable game.";
  return "Warm-up round.";
}

function roundRect(x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function drawLane() {
  const visibleLaneTop = pit.bottom;
  const floorGradient = ctx.createLinearGradient(0,0,canvas.width,canvas.height);
  floorGradient.addColorStop(0, '#25103c'); floorGradient.addColorStop(.45, '#10194c'); floorGradient.addColorStop(1, '#3b0b2e');
  ctx.fillStyle=floorGradient; ctx.fillRect(0,0,canvas.width,canvas.height);
  const glow=ctx.createRadialGradient(canvas.width/2,camera.horizonY,8,canvas.width/2,camera.horizonY,270);
  glow.addColorStop(0,'rgba(61,244,255,.34)'); glow.addColorStop(.45,'rgba(255,79,216,.16)'); glow.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=glow; ctx.fillRect(0,0,canvas.width,250);
  ctx.save(); ctx.globalAlpha=.38;
  for(let i=0;i<24;i++){ const y=125+((i*83)%575); const x=gutterOuterLeft(y)-45+((i*97)%Math.max(1,gutterOuterRight(y)-gutterOuterLeft(y)+90)); const size=5+screenScale(y)*(4+(i%4)*3); ctx.strokeStyle=i%2===0?'#ff4fd8':'#38e8ff'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(x,screenYFromWorld(y),size,0,Math.PI*2); ctx.stroke(); }
  ctx.restore();
  const gut=ctx.createLinearGradient(0,camera.horizonY,0,camera.bottomY); gut.addColorStop(0,'#020206'); gut.addColorStop(.55,'#171725'); gut.addColorStop(1,'#030305');
  ctx.fillStyle=gut; ctx.beginPath(); ctx.moveTo(gutterOuterLeft(visibleLaneTop),screenYFromWorld(visibleLaneTop)); ctx.lineTo(laneScreenLeft(visibleLaneTop),screenYFromWorld(visibleLaneTop)); ctx.lineTo(laneScreenLeft(lane.bottom),screenYFromWorld(lane.bottom)); ctx.lineTo(gutterOuterLeft(lane.bottom),screenYFromWorld(lane.bottom)); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(laneScreenRight(visibleLaneTop),screenYFromWorld(visibleLaneTop)); ctx.lineTo(gutterOuterRight(visibleLaneTop),screenYFromWorld(visibleLaneTop)); ctx.lineTo(gutterOuterRight(lane.bottom),screenYFromWorld(lane.bottom)); ctx.lineTo(laneScreenRight(lane.bottom),screenYFromWorld(lane.bottom)); ctx.closePath(); ctx.fill();

  // Raised neon gutter lips, drawn in perspective so they no longer read as flat side bars.
  ctx.save();
  ctx.strokeStyle='rgba(255,79,216,.66)';
  ctx.lineWidth=5;
  strokeWorldLine(lane.left,visibleLaneTop,lane.left,lane.bottom);
  strokeWorldLine(lane.right,visibleLaneTop,lane.right,lane.bottom);
  ctx.strokeStyle='rgba(61,244,255,.36)';
  ctx.lineWidth=2.2;
  strokeWorldLine(gutters.left.x,visibleLaneTop,gutters.left.x,lane.bottom);
  strokeWorldLine(gutters.right.x+gutters.right.width,visibleLaneTop,gutters.right.x+gutters.right.width,lane.bottom);
  ctx.restore();

  const laneGrad=ctx.createLinearGradient(0,camera.horizonY,0,camera.bottomY); laneGrad.addColorStop(0,'#ad6428'); laneGrad.addColorStop(.42,'#d18a3f'); laneGrad.addColorStop(.75,'#e6a85a'); laneGrad.addColorStop(1,'#f0bc73');
  ctx.fillStyle=laneGrad; ctx.beginPath(); ctx.moveTo(laneScreenLeft(visibleLaneTop),screenYFromWorld(visibleLaneTop)); ctx.lineTo(laneScreenRight(visibleLaneTop),screenYFromWorld(visibleLaneTop)); ctx.lineTo(laneScreenRight(lane.bottom),screenYFromWorld(lane.bottom)); ctx.lineTo(laneScreenLeft(lane.bottom),screenYFromWorld(lane.bottom)); ctx.closePath(); ctx.fill();
  for(let i=0;i<=12;i++){ const x=lane.left+(lane.right-lane.left)*i/12; ctx.strokeStyle=i%2===0?'rgba(80,38,12,.28)':'rgba(255,235,170,.17)'; ctx.lineWidth=(i===0||i===12)?2.2:1; strokeWorldLine(x,visibleLaneTop,x,lane.bottom); }
  ctx.save(); ctx.globalAlpha=.28; const shine=ctx.createLinearGradient(0,camera.horizonY,0,camera.bottomY); shine.addColorStop(0,'rgba(255,255,255,.32)'); shine.addColorStop(.55,'rgba(255,255,255,.08)'); shine.addColorStop(1,'rgba(255,255,255,.22)'); fillWorldQuad(lane.left+35,visibleLaneTop,lane.right-35,lane.bottom,shine); ctx.restore();
  const deck=ctx.createLinearGradient(0,screenYFromWorld(pit.bottom),0,screenYFromWorld(lane.top+210)); deck.addColorStop(0,'#dca15a'); deck.addColorStop(1,'#b46a2c'); fillWorldQuad(lane.left,pit.bottom,lane.right,lane.top+210,deck);
  const pitTopY=48, pitBottomY=screenYFromWorld(pit.bottom); const pitGrad=ctx.createLinearGradient(0,pitTopY,0,pitBottomY); pitGrad.addColorStop(0,'#020207'); pitGrad.addColorStop(.58,'#11111d'); pitGrad.addColorStop(1,'#050508'); ctx.fillStyle=pitGrad; ctx.fillRect(camera.topGutterOuterLeft,pitTopY,camera.topGutterOuterRight-camera.topGutterOuterLeft,pitBottomY-pitTopY); ctx.strokeStyle='rgba(80,230,255,.5)'; ctx.lineWidth=3; ctx.strokeRect(camera.topGutterOuterLeft,pitTopY,camera.topGutterOuterRight-camera.topGutterOuterLeft,pitBottomY-pitTopY);
  ctx.strokeStyle='rgba(255,79,216,.55)'; ctx.lineWidth=4; strokeWorldLine(lane.left,visibleLaneTop,lane.left,lane.bottom); strokeWorldLine(lane.right,visibleLaneTop,lane.right,lane.bottom);
  ctx.strokeStyle='rgba(61,244,255,.34)'; ctx.lineWidth=2; strokeWorldLine(gutters.left.x,visibleLaneTop,gutters.left.x,lane.bottom); strokeWorldLine(gutters.right.x+gutters.right.width,visibleLaneTop,gutters.right.x+gutters.right.width,lane.bottom);
  ctx.save(); ctx.strokeStyle='#ff3158'; ctx.lineWidth=3.2; strokeWorldLine(lane.left,releaseZone.top,lane.right,releaseZone.top); ctx.globalAlpha=.16; fillWorldQuad(lane.left,releaseZone.top,lane.right,lane.bottom,'#ff3158'); ctx.restore();
  ctx.fillStyle='rgba(70,255,230,.72)'; const arrowY=445; for(const x of [lane.left+58,lane.left+93,(lane.left+lane.right)/2,lane.right-93,lane.right-58]){ const p=worldToScreen(x,arrowY), sc=screenScale(arrowY); ctx.beginPath(); ctx.moveTo(p.x,p.y-10*sc); ctx.lineTo(p.x-7*sc,p.y+8*sc); ctx.lineTo(p.x+7*sc,p.y+8*sc); ctx.closePath(); ctx.fill(); }
  for(let i=0;i<7;i++){ const y=150+i*78, a=worldToScreen(lane.left+18,y), b=worldToScreen(lane.right-18,y); ctx.strokeStyle='rgba(255,255,255,.13)'; ctx.lineWidth=Math.max(1,screenScale(y)*1.6); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); }
}
function drawPins() {
  const drawList = [...pins].sort((a, b) => a.y - b.y);

  for (const pin of drawList) {
    if (pin.standing) {
      drawUprightPin(pin);
    } else {
      drawFallenPin(pin);
    }
  }
}

function drawUprightPin(pin) {
  ctx.save();
  const projected = worldToScreen(pin.x, pin.y);
  const sc = pinScreenScale(pin.y);
  ctx.translate(projected.x, projected.y - (pin.deploy || 0) * 80 * sc);
  ctx.scale(sc, sc);

  // Grounded oval shadow. The flat bottom of the pin sits directly on this.
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath();
  ctx.ellipse(0, 13.5, 8.8, 2.7, 0, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createRadialGradient(-4, -13, 2, 0, -2, 26);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(0.34, "#fff9ec");
  body.addColorStop(0.72, "#dfdfdf");
  body.addColorStop(1, "#9c9c9c");

  // Perfectly vertical silhouette with a deliberately flat foot.
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -28);
  ctx.bezierCurveTo(4.9, -27, 6.3, -19, 4.1, -11);
  ctx.bezierCurveTo(9.6, -6, 10.7, 6.5, 7.4, 14.0);
  ctx.lineTo(-7.4, 14.0);
  ctx.bezierCurveTo(-10.7, 6.5, -9.6, -6, -4.1, -11);
  ctx.bezierCurveTo(-6.3, -19, -4.9, -27, 0, -28);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(80,45,20,0.22)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Red neck bands stay horizontal so upright pins no longer feel tilted.
  ctx.fillStyle = "#e21b36";
  ctx.beginPath();
  ctx.ellipse(0, -12.7, 5.3, 1.75, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#b90f26";
  ctx.beginPath();
  ctx.ellipse(0, -9.4, 5.9, 1.75, 0, 0, Math.PI * 2);
  ctx.fill();

  // Flat bottom cap.
  ctx.fillStyle = "rgba(238,238,238,0.98)";
  ctx.beginPath();
  ctx.roundRect(-7.2, 11.0, 14.4, 4.1, 1.2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.66)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-5.8, 12.0);
  ctx.lineTo(5.8, 12.0);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.64)";
  ctx.beginPath();
  ctx.ellipse(-3.25, -16, 1.35, 7.2, -0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawFallenPin(pin) {
  const speed = Math.sqrt(pin.vx * pin.vx + pin.vy * pin.vy);

  if (speed > 0.06) {
    const targetAngle = Math.atan2(pin.vy, pin.vx) + (pin.angleWobble || 0);
    pin.fallAngle = lerp(pin.fallAngle || targetAngle, targetAngle, 0.18);
  }

  ctx.save();
  const projected = worldToScreen(pin.x, pin.y);
  const sc = fallenPinScreenScale(pin.y);
  ctx.translate(projected.x, projected.y);
  ctx.scale(sc, sc);
  ctx.rotate(pin.fallAngle);

  ctx.fillStyle = "rgba(0,0,0,0.36)";
  ctx.beginPath();
  ctx.ellipse(1, 7.3, 18.0, 4.1, 0, 0, Math.PI * 2);
  ctx.fill();

  const bodyColor = pin.inPit ? "#cfcfcf" : "#fff7e8";
  const shadeColor = pin.inPit ? "#8b8b8b" : "#c7bba5";
  const darkEdge = pin.inPit ? "#666" : "#a6947b";

  const fallenBody = ctx.createLinearGradient(-21, -7, 21, 7);
  fallenBody.addColorStop(0, darkEdge);
  fallenBody.addColorStop(0.16, shadeColor);
  fallenBody.addColorStop(0.34, "#ffffff");
  fallenBody.addColorStop(0.68, bodyColor);
  fallenBody.addColorStop(1, shadeColor);

  // Sideways sprite with a flat underside so it reads as resting on the lane.
  ctx.fillStyle = fallenBody;
  ctx.beginPath();
  ctx.moveTo(-22, -5.7);
  ctx.bezierCurveTo(-18.5, -8.1, -11.5, -7.8, -5.4, -5.6);
  ctx.lineTo(7.5, -5.6);
  ctx.bezierCurveTo(15.2, -6.6, 21.5, -3.7, 22.4, 0);
  ctx.bezierCurveTo(21.5, 3.7, 15.2, 6.6, 7.5, 5.6);
  ctx.lineTo(-18.4, 5.6);
  ctx.lineTo(-22, 3.6);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(70,45,28,0.25)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Flat contact strip underneath the fallen pin.
  ctx.fillStyle = "rgba(120,85,55,0.18)";
  ctx.fillRect(-17.5, 4.2, 25.0, 2.8);

  // Red bands curve around the body instead of looking like simple blocks.
  ctx.fillStyle = pin.inPit ? "#7d111d" : "#d71932";
  ctx.beginPath();
  ctx.roundRect(-6.8, -6.0, 3.5, 12.0, 1.2);
  ctx.roundRect(-1.5, -6.4, 3.5, 12.8, 1.2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.56)";
  ctx.beginPath();
  ctx.ellipse(8.3, -3.2, 6.5, 1.55, -0.08, 0, Math.PI * 2);
  ctx.fill();

  // Neck end and flat base end details.
  ctx.fillStyle = "rgba(95,55,30,0.25)";
  ctx.beginPath();
  ctx.ellipse(-21.2, 0, 2.4, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.48)";
  ctx.beginPath();
  ctx.moveTo(7.4, 5.1);
  ctx.lineTo(17.2, 4.4);
  ctx.lineTo(18.8, 6.0);
  ctx.lineTo(7.4, 6.5);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawBall() {
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  const glow = Math.min(1, speed / 14);

  ctx.save();
  const projected = worldToScreen(ball.x, ball.y);
  const sc = ballScreenScale(ball.y);
  const floorSc = screenScale(ball.y);

  ctx.save();
  ctx.globalAlpha = ball.inPit ? 0.18 : 0.22;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(projected.x + 4 * floorSc, projected.y + ball.r * sc * 0.74, ball.r * sc * 0.92, ball.r * sc * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.translate(projected.x, projected.y);
  ctx.scale(sc, sc);

  const shell = ctx.createRadialGradient(-7, -9, 4, 0, 0, ball.r + 5);
  if (ball.inPit) {
    shell.addColorStop(0, "#555");
    shell.addColorStop(0.45, "#2f2f35");
    shell.addColorStop(1, "#111");
  } else if (ball.inGutter) {
    shell.addColorStop(0, "#686868");
    shell.addColorStop(0.45, "#33343a");
    shell.addColorStop(1, "#101014");
  } else {
    const palette = getBallPalette();
    shell.addColorStop(0, palette.top);
    shell.addColorStop(0.32, palette.mid);
    shell.addColorStop(0.68, palette.low);
    shell.addColorStop(1, palette.edge);
  }

  const palette = getBallPalette();
  ctx.shadowColor = ball.inGutter || ball.inPit ? "rgba(0,0,0,0)" : `${palette.glow} ${0.25 + glow * 0.45})`;
  ctx.shadowBlur = ball.inGutter || ball.inPit ? 0 : 12 + glow * 10;

  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.arc(0, 0, ball.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;

  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, ball.r - 1, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.rotate(ball.rotation);

  drawBallHole(-6, -6, 3.6);
  drawBallHole(5, -5, 3.2);
  drawBallHole(-1, 5, 3.4);

  ctx.strokeStyle = `rgba(255,255,255,${0.10 + glow * 0.18})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, ball.r - 6, -0.8, 0.75);
  ctx.stroke();

  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.beginPath();
  ctx.ellipse(-7, -9, 5.5, 3, -0.55, 0, Math.PI * 2);
  ctx.fill();

  if (glow > 0.08 && !ball.inPit) {
    ctx.strokeStyle = `${getBallPalette().glow} ${0.14 * glow})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, ball.r + 3 + glow * 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBallHole(x, y, radius) {
  const hole = ctx.createRadialGradient(x - 1, y - 1, 1, x, y, radius + 2);
  hole.addColorStop(0, "#050505");
  hole.addColorStop(0.55, "#141414");
  hole.addColorStop(1, "rgba(255,255,255,0.16)");

  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath();
  ctx.arc(x + 1, y + 1, radius * 0.72, 0, Math.PI * 2);
  ctx.fill();
}

function drawAimLine() {
  const start = worldToScreen(ball.x, ball.y);
  const targetWorld = { x: ball.x + (dragStart.x - dragCurrent.x) * 2, y: ball.y + (dragStart.y - dragCurrent.y) * 2 };
  const target = worldToScreen(targetWorld.x, targetWorld.y);
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(target.x, target.y);
  ctx.stroke();
}


function pinCountText(count) {
  return count === 1 ? "1 pin" : count + " pins";
}

function evaluateRollMessage(knocked, standingBefore, rollNumber, frameNumber, wasGutter) {
  if (wasGutter || knocked === 0) {
    strikeStreak = 0;
    showAnnouncer("GUTTER BALL!", "Better angle next time.", 120, true);
    return;
  }

  const isStrike = rollNumber === 1 && knocked === 10;
  const isSpare = rollNumber > 1 && knocked === standingBefore;

  if (isStrike) {
    strikeStreak++;

    if (frameNumber === 10) {
      const tenth = getTenthFrameRolls();
      if (calculateScore() === 300 && tenth.length >= 3) {
        showAnnouncer("PERFECT GAME!", "300", 220, true);
      } else if (tenth.length === 1) {
        showAnnouncer("STRIKE!", "One more!", 140, true);
      } else {
        showAnnouncer("STRIKE!", "Keep it going!", 140, true);
      }
      return;
    }

    const strikeMessages = [
      "STRIKE!",
      "DOUBLE!",
      "TURKEY!",
      "FOUR BAGGER!",
      "FIVE IN A ROW!",
      "SIX PACK!",
      "LUCKY SEVEN!",
      "EIGHT STRAIGHT!",
      "NINE IN A ROW!",
      "FRONT TEN!",
      "FRONT ELEVEN!",
      "PERFECT GAME!"
    ];

    const text = strikeMessages[Math.min(strikeStreak - 1, strikeMessages.length - 1)];
    showAnnouncer(text, "", 145, true);
    return;
  }

  strikeStreak = 0;

  if (isSpare) {
    let spareText = standingBefore <= 3 ? "ICE COLD SPARE!" : "SPARE!";
    let spareSubtext = "Clean pickup.";
    if (spareText === "ICE COLD SPARE!" && Math.random() < 0.15) {
      spareText = "ARE YOU KIDDING ME?!";
      spareSubtext = "Who do you think you are? I am!";
    }
    showAnnouncer(spareText, spareSubtext, 130, false);
    return;
  }

  if (knocked >= 9) {
    showAnnouncer("SO CLOSE!", "One pin standing.", 120, false);
  } else if (knocked >= 6) {
    showAnnouncer("NICE SHOT!", pinCountText(knocked) + " down.", 105, false);
  } else if (knocked >= 3) {
    showAnnouncer("NOT BAD.", pinCountText(knocked) + " down.", 95, false);
  } else {
    showAnnouncer("OUCH...", pinCountText(knocked) + " down.", 95, false);
  }
}

function showAnnouncer(text, subtext = "", duration = 110, shake = false) {
  playMessageSfx(text, shake);
  announcer = { text, subtext, timer: duration, duration, shake };
  const messageText = document.getElementById("messageText");
  if (messageText) {
    messageText.textContent = subtext ? text + " — " + subtext : text;
  }
}

function drawAnnouncement() {
  if (announcer.timer <= 0) return;

  const progress = announcer.timer / announcer.duration;
  const alpha = Math.min(1, progress * 1.5);
  const scale = 1 + progress * 0.35;
  const shakeX = announcer.shake ? Math.sin(announcer.timer * 0.55) * 4 : 0;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(canvas.width / 2 + shakeX, 350);
  ctx.scale(scale, scale);

  ctx.textAlign = "center";
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.fillStyle = "#ffd36a";
  ctx.font = "bold 38px Bungee, Fredoka, Arial";
  ctx.strokeText(announcer.text, 0, 0);
  ctx.fillText(announcer.text, 0, 0);

  if (announcer.subtext) {
    ctx.font = "bold 16px Fredoka, Arial";
    ctx.fillStyle = "white";
    ctx.lineWidth = 4;
    ctx.strokeText(announcer.subtext, 0, 30);
    ctx.fillText(announcer.subtext, 0, 30);
  }

  ctx.restore();

  announcer.timer--;
}

function updateHud() {
  document.getElementById("frameText").textContent = Math.min(frame, 10);
  document.getElementById("rollText").textContent = rollInFrame;
  document.getElementById("scoreText").textContent = calculateScore();
  updateTurnBanner();
}

function resetGame(resetPlayers = true) {
  stopRollLoop();
  frame = 1;
  rollInFrame = 1;
  rolls = [];
  pinsStandingBeforeRoll = 10;
  waitingForNextRoll = false;
  gameOver = false;
  rollTimer = 0;
  strikeStreak = 0;
  pendingTurnChange = false;
  finalResultsReady = false;
  finalWinCountedLocal = false;
  if (resetPlayers && players.length) {
    players = players.map((player, index) => makePlayer(index, player.colorIndex));
    currentPlayerIndex = 0;
    selectedBallColor = players[0].colorIndex;
  }
  announcer = { text: "", subtext: "", timer: 0, duration: 1, shake: false };
  const messageText = document.getElementById("messageText");
  if (messageText) messageText.textContent = "Pick your spot behind the red line.";

  createBall();
  createPins();
  updateBallColorButtons();
  updateHud();
  updatePlayAgainButton();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampBallVelocity(maxSpeed) {
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  if (speed <= maxSpeed || speed === 0) return;

  const scale = maxSpeed / speed;
  ball.vx *= scale;
  ball.vy *= scale;
}

function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

buildBallColorButtons();
setupMenuControls();
resetGame(false);
openMenu();
gameLoop();
