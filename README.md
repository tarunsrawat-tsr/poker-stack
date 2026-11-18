# STACK.

A single-page poker ledger for a custom, card-free game. It tracks player balances, automatic blinds, betting rounds, the pot, hand winners, and the final table winner.

## Run Locally

```bash
npm install
npm run dev
```

Build and check the production output locally with:

```bash
npm run build
npm run preview
```

## Test The Game Logic

```bash
npx tsx --test tests/game.test.ts tests/app.test.tsx
npx tsc --noEmit
```

## Deploy To Vercel

The repository is already configured for Vercel — `vercel.json` pins Node 22, the Vite
framework preset, `dist` as the output directory, clean URLs, a single-page rewrite for
every path, and cache plus `X-Content-Type-Options` / `Referrer-Policy` headers. Deploy it
as-is.

**Git import (recommended)**

1. Push this project to GitHub, GitLab, or Bitbucket.
2. Vercel dashboard → **Add New… → Project → Import** the repository.
3. Confirm Framework Preset **Vite**, Build Command `npm run build`, Output Directory `dist`.
4. **Deploy**. Pushes to the default branch ship to production; other branches get preview URLs.

**Vercel CLI**

```bash
npx vercel          # preview deployment
npx vercel --prod   # production deployment
```

**Share previews (one environment variable)**

Set the deployed origin in **Project → Settings → Environment Variables (Production)**, then
redeploy so the build can emit an absolute social image URL:

```
VITE_SITE_URL=https://your-project.vercel.app
```

`.env` keeps a safe empty default (see `.env.example`); without the variable, `og:image`
resolves relatively and X/Twitter cannot render `public/og-cover.jpg`.

**Deployment notes**

- The build inlines all JavaScript and CSS into a single `dist/index.html`
  (`vite-plugin-singlefile`). `public/favicon.svg` and `public/og-cover.jpg` are copied
  beside it and served as static files.
- There is no server, API, or database. Game state lives only in each visitor's
  `localStorage`, so every table is private to its device and there is nothing to migrate.
- A custom domain needs no config change: **Settings → Domains**, and the SPA rewrite
  already covers every path.

## Table Rules

- Add at least three players to start a game. Everyone receives the same starting stack. Start may also be the Big or the Small, but Big and Small must always be different funded players.
- **Player Reordering**: You can reorder players before starting the match using the **↑** and **↓** arrows on each player row or by dragging rows to arrange table seating. Role assignments follow the reordered players.
- You can explicitly select the **Start player**, **BIG player**, and **SMALL player** for each new game (as well as adjust roles at the start of a hand or for the upcoming hand at showdown).
- The Big blind starts at 100 and **doubles for every player out at the start of a hand**: `100 * 2 ^ (players with zero available chips before blinds)`. The Small blind is half of the Big. An all-in player stays eligible in the current hand; elimination changes the blinds on the next hand, not after bets have been posted. Both blinds post automatically for the selected Big and Small players.
- Before a new hand, eliminated seats are skipped when assigning Start, Big, and Small. If the next Big or Small is out, that title goes to the next funded player in the table rotation, including the Starter if they are next. Big and Small are still held by different people. The showdown role selectors list only funded players.
- With exactly two funded players, both still post blinds. The Starting token rotates independently and can belong to either blind holder. You can change Start, Big, and Small before betting. An all-in blind posts only what is left in that player's stack.
- The Starter always acts first, even when they also post Big or Small. After the Starter, each non-blind player acts in order, followed by any Big or Small who has not acted yet. No one takes two turns in a betting iteration solely because they hold two titles.
- **In-Hand Response Editing & Rewind**: During an ongoing hand, click on any player's card to view their action history and edit their response. You can rewind the hand directly to that player's turn to redo their decision, or change their move to a check/match, fold, or custom raise directly from the modal. You can also use the **Undo last move** button in the Action Panel or undo an accidental fold win.
- **Correct a stack mid-game**: Click any player card and use **Correct remaining stack** to set that player's *available* chips to any non-negative whole number. The amount already committed to bets and the central pot do not change. Corrections are recorded and undoable; rewinding an earlier action also discards corrections made after it. A player corrected to zero sits out if they have not entered this hand, or remains all-in if they already committed chips. Adding chips back to a sitting-out player rejoins them on the next hand. The Big blind is recalculated from the then-current out players at the next hand. Manual corrections add or remove chips from the table; the original exact win target remains `(player count - 1) * starting stack`.
- A raise input is the total bet for the current round, not an additional contribution. Round bets reset on Flop, Turn, and River; the pot does not.
- A player with too few chips posts or calls only what remains and stays eligible as all-in. Players with zero chips at the start of a hand sit out that hand. No side pots are modeled; the full pot goes to the selected eligible winner.
- If everyone else folds, the remaining player wins automatically. A showdown can settle a hand at any time.
- The exact winning balance is `(player count - 1) * starting stack`. It is checked after every balance change. If just one player has chips, the session also finishes rather than starting an unplayable hand.

The active session is saved in browser local storage and resumes on refresh. New Game clears that session.