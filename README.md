# বাংলা মনোপলি (Bangla Monopoly)

An online multiplayer Monopoly-style board game themed on Bangladesh.
2 to 4 players join a private room with a 4-letter code and play in real time
from their own phones or computers. The rules follow classic Monopoly; the
board uses Bangladeshi districts, the currency is Taka (৳), and the whole
interface is in Bangla.

Features: rooms and lobby, server-controlled dice and turn timer, buying and
rent, owner auctions (house rule "C"), ভাগ্য / সমাজকল্যাণ cards, jail, houses
and hotels, mortgages, trading, debts and bankruptcy, a winner screen,
reconnection after a refresh, a mobile layout and an optional Bengali-digit
display.

## Tech

- Node.js 18+ with Express and Socket.IO (no database: game state is kept in
  memory, so a server restart ends running games)
- Plain HTML, CSS and JavaScript in `public/` (no build step)
- The server is authoritative: it rolls the dice and validates every action

```
server.js        Express + Socket.IO entry point
game/            config.js (rules and timings), rooms.js, engine.js, errors.js
data/            board.js (squares, prices, rents), cards.js, pieces.js
public/          index.html (home + lobby), game.html, css/, js/
scripts/         check-board.js (rent table sanity check)
```

Rules, values and timings live in `game/config.js` and `data/`. The full
specification is in `SPEC.md`; the decided house rules are in `CLAUDE.md`.

## Run locally

Requires Node.js 18 or newer.

```powershell
npm install
npm run dev          # auto-restarts on server changes; or: npm start
```

Open http://localhost:3000, create a room, and join from other browser
windows (use a private window or another browser for each extra player).

To play from phones on the same Wi-Fi, open `http://<your-PC-IP>:3000`
(find the IP with `ipconfig`) and allow Node.js through the firewall if asked.

### Testing helpers

```powershell
npm run check                          # checks the rent table in data/board.js
$env:DEBUG_DICE = "1"; npm run dev     # test mode (PowerShell)
```

With `DEBUG_DICE=1` the current player can choose the dice values and the next
card, and the host can set any player's cash. Without the variable the server
ignores all of this. Never set it on a public server.

## Deploy (Render + GitHub)

1. Push this repository to GitHub.
2. On [Render](https://render.com), create a **New → Web Service** and connect
   the repository.
3. Settings:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/healthz` (optional)
   - Do **not** set `DEBUG_DICE`.
4. Deploy. Render sets `PORT` automatically; the server reads it.
5. Share the Render URL (for example `https://bangla-monopoly.onrender.com`).
   Players create or join rooms there.

Notes: on Render's free plan the service sleeps when idle, so the first visit
can take a little while; games in progress are lost when the service restarts
or redeploys. A detailed step-by-step guide follows in build step 11.
