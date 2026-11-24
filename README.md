# ♛ CheckMate

<img src="public/icon-256.png" width="128" alt="CheckMate icon">


**A live party game for family dinners.** Everyone guesses the total bill on their own phone, then the receipt
holder types in the real number and every phone does a drumroll reveal together, followed by charts, awards and
a leaderboard.

## What it does

- **Join by code, QR or link.** One person opens a table and everyone else scans the QR code. No accounts, nothing to install.
- **Secret guesses.** Nobody sees anyone else's number until the reveal. You do see live who has locked in and how fast.
- **Trash talk.** Add an optional one-liner to your guess ("Wine was NOT cheap"). It gets shown at the reveal.
- **The big reveal.** A 3-2-1 drumroll on every phone, the real total counting up, confetti, sound and vibration.
- **Results:**
  - The real bill, the group **average** and **median**, and how far off each one was.
  - A 🥇🥈🥉 **podium**.
  - **Wisdom of the crowd:** did the group average beat most people?
  - 📍 **"Where everyone landed"**, a number line with each person's guess, the real bill and the average.
  - 🎯 **"How far off?"**, a bar chart of who went too low (blue) and who went too high (red).
  - ⚡ **Speed race**, showing who answered fastest.
  - 🎖️ **Awards:** Closest, Farthest off 🤡, Fastest finger ⚡, Still reading the menu 🐢, Big spender 💸,
    Cheapskate 🪙, Flip-flopper 🔄, Most average person 😐 and Bullseye 🎯.
  - A funny verdict for each player, like "Eagle eye 🦅", "Thinks we ate lobster 🦞" or "Has never paid a bill 🧒".
- **Live emoji reactions** (😂🔥😱👏🍅💸) that float up on everyone's screen.
- **Two rule sets:** 🎯 *Closest wins*, or 💥 *Don't go over*, where you're out if you guess higher than the bill.
- **More rounds** (Dessert 🍰, Drinks 🍷 …) with an **overall leaderboard**.
  Points per round: 🥇 5, 🥈 3, 🥉 2, everyone else 1, and +3 for a guess within 1%.
- **Bill splitter** with a tip slider, plus a "farthest off buys dessert" rule 😈.
- **Share the results** as text to the family WhatsApp group.
- Works in light and dark mode and is built for phones first. If you refresh or switch phones, you keep your seat: join again with the same name.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer. There is nothing to install with npm.

```bash
npm start
```

The terminal prints a **Network** address such as `http://192.168.1.23:3000`. Open it on every phone that is on
the **same Wi-Fi**.

## Put it online (so it works on mobile data too)

The app is a single small Node server. It keeps rooms in memory and uses Server-Sent Events for live updates.
It runs on any host that supports Node:

- **Render (free):** go to [render.com](https://render.com) and choose **New → Blueprint**, then pick this repo.
  `render.yaml` already has the settings. You get a URL like `https://checkmate.onrender.com`.
  Free instances go to sleep when idle, so open the link a minute before dinner.
- **Railway / Fly.io / any Docker host:** use the included `Dockerfile`, which listens on `$PORT`.

> It needs one long-running server process, not serverless functions (for example, Vercel functions won't work),
> because every phone keeps a live connection open.

## Develop

```bash
npm run dev   # restarts on file changes
npm test      # scoring tests + API tests
```

```
server.js            HTTP server: static files, JSON API, live updates over SSE
public/index.html    app shell
public/styles.css    theme (dark/light)
public/js/app.js     screens, live connection, reveal sequence
public/js/stats.js   scoring, awards, leaderboard (shared with the tests)
public/js/charts.js  hand-made SVG charts with tap tooltips
public/js/fx.js      synthesized sounds, confetti, floating reactions
public/vendor/       qrcode-generator (MIT)
public/icon-*.png    app icon (also favicon / home-screen icon)
test/                node:test suites
```

### API (all JSON)

| Method | Path | What |
|---|---|---|
| POST | `/api/rooms` | create a table `{name, avatar, title, currency, mode}` |
| GET | `/api/rooms/:code` | peek at a table (title, who is there) |
| POST | `/api/rooms/:code/join` | `{name, avatar}` → `{pid, token}` |
| GET | `/api/rooms/:code/events?pid&token` | live SSE stream of the table |
| POST | `/api/rooms/:code/guess` | `{pid, token, amount, quote}` |
| POST | `/api/rooms/:code/reveal` | `{pid, token, actual}` |
| POST | `/api/rooms/:code/next` | start another round `{label}` |
| POST | `/api/rooms/:code/react` | `{emoji}` floats on every screen |
| POST | `/api/rooms/:code/settings`, `/kick`, `/profile` | host settings / remove a player / rename |

Other players' guesses are removed from the data the server sends until the reveal, so nobody can peek in the developer tools 😉.
