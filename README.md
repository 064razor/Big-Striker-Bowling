# Big Striker Bowling Online - Final Multiplayer Build

This build includes the online lobby polish added before GitHub deployment:

- Player names, with Player 1-4 defaults when a name is blank
- Colored player icons matching selected ball colors
- Lobby chat
- Ready / Not Ready indicators before the host starts
- Host start button locked until everyone is ready
- Copy room code button
- Play Again rematch flow after final results
- Session win counts and final Champion / Runner Up / Podium labels

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Test multiplayer locally

Open the game in two browser windows, or use another device on the same Wi-Fi:

```text
http://YOUR_PC_IP:3000
```

The host creates a room, other players join with the room code, everyone marks Ready, then the host starts the game.

## Deploy to Render

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Do not upload `node_modules`; it is ignored by `.gitignore`.
