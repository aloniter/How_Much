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
- **English or Hebrew 🇬🇧🇮🇱.** Each phone chooses its own language, and Hebrew phones get Hebrew automatically. Hebrew switches the whole layout to right-to-left. You can switch any time from the home screen or the bottom of the game screen, and you can type the table code on a Hebrew keyboard without switching to English.
- Works in light and dark mode and is built for phones first. If you refresh or switch phones, you keep your seat: join again with the same name.

## 🏆 Family Hall of Fame

Each dinner adds to the family's permanent championship.

- **No accounts.** Start a *family* once and get a 6-letter family code. At a family table everyone taps their own avatar ("That's me!") instead of typing a name. Each phone remembers who you are.
- **No duplicate people.** If someone types a name that looks like an existing member ("dad" vs "Dad", "Dani" vs "Danny"), the app asks *"Is this you?"* Friends can join as **guests**, who play normally but aren't recorded. If a duplicate slips through anyway, **Merge** in Family settings combines the two histories.
- **Leaderboard:** wins, win rate, rounds and dinners played, average miss in %, average answer time, current and longest winning streaks, exact guesses and bullseyes, whether you tend to guess over or under, a head-to-head record against each family member, and recent form.
- **Records:** most expensive and cheapest bill, most accurate family average, biggest miss, fastest guess, biggest table, and total spent.
- **Titles that change hands as results come in:** The Family Accountant 🧮, The Reigning Champion 👑, Inflation Denier 📉, Michelin Mentality ⭐, The Human Calculator 🤖, Financial Disaster 💥, One Hit Wonder 🎸, The Comeback King 🔁, Quick Draw ⚡, The Philosopher 🐢 and The Regular 🍽️. Titles unlock after 3 rounds.
- **Achievements** you keep for good: First win, Hat-trick, Bullseye, Exact!, Dinner champion, Speed demon, Giant slayer, Comeback, Epic miss, Regular and Veteran.
- **Player profiles** with a miss-over-time chart, best and worst guess ever, and head-to-head bars.
- **Dinner history** with dates, place names, bills, every guess, winners, awards and how close the family average was. You can remove a dinner that was recorded by mistake.
- **Three levels of results, clearly labelled:** *this round*, *tonight* (all rounds of one dinner) and *all-time* (the Hall of Fame).
- **Saved once per round.** Each round is stored under an ID made from its dinner and round number. Correcting a mistyped bill ("✏️ Fix the bill", host or revealer, within an hour) updates that same record instead of adding a second one.

## 🔥 The Roast

After the winner is revealed, every phone plays **Roast of the Night** at the same moment. Each player gets a personal roast (the winner gets a compliment), and the biggest miss gets a dramatic finale with a siren and drumroll 🚨🥁.

- Jokes are picked from the real game data: how far off you were in money and %, whether you guessed over or under, your speed, how many times you changed your guess (and whether it got worse), your place, the family average, and with family history your losing or winning streak, first win, comeback, personal records and rivalries (*"You finally beat Dad. Screenshot this before it happens again."*).
- A **template library** of about 150 lines per language, plus extra one-liners that can be added at the end, combined from the data. English and Hebrew were written separately for natural humour, not translated line by line. The Hebrew lines use second-person past tense, which reads the same for any gender.
- **No repeats:** every phone shows the same roast for the same round, and each person cycles through the lines for a situation before any line comes back.
- **Live emoji reactions** on each roast card, with counts that update on every phone.
- **📤 Share:** any roast card becomes a 1080×1350 image ready for WhatsApp, in English or Hebrew (right-to-left).
- No external AI service is used. It's a small template engine in `public/js/roast.js`, with the jokes in `public/js/roast-lines.js`.

## Where the data lives

All data is in two JSON files in `DATA_DIR` (default `./data`): `rooms.json` (live tables, forgotten after a day) and `families.json` (Hall of Fame, kept forever). Writes go to a temporary file that is then renamed into place, and a `.bak` copy of the previous version is kept. Data is also saved on shutdown, which is what hosts send on a redeploy.

To keep the history across **deploys**, point `DATA_DIR` at a persistent disk or volume. The `Dockerfile` declares a `/data` volume, and `render.yaml` shows where to add a Render disk.

On hosts with no persistent disk (such as Render's free plan), use **⚙️ Family settings → Download backup** now and then. If the server is ever reset, use **Restore from a backup file** on the home screen. Restoring the same backup twice never duplicates anything.

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
npm test      # scoring, Hall of Fame stats, roast engine, API + restart-persistence tests
```

```
server.js            HTTP server: static files, JSON API, live updates over SSE, families
lib/store.js         durable JSON store (atomic writes, .bak, flush on shutdown)
public/index.html    app shell
public/styles.css    theme (dark/light)
public/js/app.js     screens, live connection, reveal sequence
public/js/stats.js   scoring, awards, leaderboard (shared with the tests)
public/js/charts.js  hand-made SVG charts with tap tooltips
public/js/fx.js      synthesized sounds, confetti, floating reactions
public/js/i18n.js    English + Hebrew text, language switching, RTL
public/js/hall.js    Hall of Fame statistics, records, titles, achievements (pure)
public/js/hallview.js  Hall of Fame screens and charts
public/js/family.js  families remembered on this phone + history cache
public/js/roast.js   roast engine (situation picking, rotation, kickers)
public/js/roast-lines.js  the joke library (EN + HE)
public/js/roastview.js   synchronized Roast of the Night show + shareable card images
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
| POST | `/api/rooms/:code/fix` | correct a mistyped bill `{actual}` (updates the same history record) |
| POST | `/api/families` | create a family `{name, member: {name, avatar}}` |
| GET | `/api/families/:code` | the family's members + full dinner history |
| GET | `/api/families/:code/events` | live SSE: the Hall of Fame changed |
| POST | `/api/families/:code/members` | add a member `{name, avatar, force}` (409 `similarName` → "is this you?") |
| POST | `/api/families/:code/merge` | merge a duplicate `{from, into}` |
| POST | `/api/families/:code/dinners/:id/delete` | remove a dinner from the Hall of Fame |
| GET | `/api/families/:code/export` · POST `/api/families/import` | backup / restore |

Room creation also accepts `{familyCode, memberId}`. Joining a family table accepts `{memberId}` (tap yourself), `{name, avatar}` (new member) or `{name, avatar, guest: true}`. A reaction `{emoji, target}` counts toward that player's roast card.

Other players' guesses are removed from the data the server sends until the reveal, so nobody can peek in the developer tools 😉.
