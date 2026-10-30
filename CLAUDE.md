# CLAUDE.md: integrating Cyber Rally into the Cyber Aware platform

This repository is **«رالي سايبر: كورنيش الرسائل» (Cyber Rally, track 1)**, a 3D racing game for children that teaches
phishing and scam awareness, in Arabic (RTL). It is a static web app (Vite + TypeScript + Babylon.js 8) that runs entirely
on the player's device (phone or desktop browser): no game server, no server GPU, any number of simultaneous players.

Your task in the platform repository: **place the game on the platform's game page and wire the result back.**

## How the game works (so you can describe it in the platform)
The kart drives itself along an Omani corniche; the child only changes lane (◀ ▶ buttons, tapping either half of the screen,
swiping, or the arrow keys). Six decisions on the theme of phishing and scams:
- Five **gates** with three coloured lanes. Each lane is an answer and the kart's lane is the choice.
- One **pit stop** where a phone message opens. The child taps the sender's address to compare it with the official one.

A safe choice gives a speed boost and stalls the rival kart «الفيروس». An unsafe choice slows the kart, explains why, and
the same question comes back as a second chance (60 % credit). Golden shields, boost pads, pop-up windows to avoid and the
race against the virus are for fun only. A race lasts about 1.5 to 3 minutes.

## What is here
- `dist/`: the ready-to-serve build (about 16 MB). It works from any sub-path (`base: './'`).
- `integration/react/CyberAwareGame.tsx`: the React component (iframe + secure `postMessage`), the same one used by other
  Cyber Aware games.
- `src/`: the source.
  - `src/race/*` is the race.
  - `src/game/assessment.ts` is the scoring engine.
  - `src/data/missions.json` holds the scoring rules; `src/data/content-ar.json` holds all the Arabic text.
- `tests/assessment.test.mjs`: scoring tests (`npm test`).
- `scripts/validate.mjs`: content and safety checks (run by `npm run build`).
- `pipeline/build_race_kit.py`: the Blender script that made `public/assets/race-kit.glb` (the original kart, gates, pit,
  dhow, fort and so on).

## Integration steps (React platform)
1. Copy `dist/` to the platform's static files, e.g. `public/games/cyber-rally/`, or upload it to the platform's CDN.
   Keep the structure (`index.html`, `assets/`, `fonts/`).
2. Copy `integration/react/CyberAwareGame.tsx` into the platform once (e.g. `src/components/games/`), unless it is already
   there from another Cyber Aware game.
3. Render it inside a container with a real height:
   ```tsx
   <div style={{ height: '100dvh' }}>
     <CyberAwareGame src="/games/cyber-rally/index.html" title="رالي سايبر" onComplete={handleComplete} onEvent={handleEvent} />
   </div>
   ```
4. Messages from the game (each is `{ type, protocolVersion: 1, gameId: 'cyber-rally-corniche', data }`):
   - `game.started`: `{ gameId, runId }`.
   - `game.decision`: `{ gameId, checkpointId, actionId, safe }`. For progress display only.
   - `game.completed`, passed to `onComplete({ result, ledger, fun })`:
     - `result`: the knowledge score (`earnedPoints` out of 100, `passed` at ≥ 70 %, `missionResults`, `checkpointResults`).
     - `ledger`: the ordered decisions.
     - `fun`: `{ stars, coins, coinsTotal, seconds, beatVirus }`. Never store `fun` as a grade.
5. To store scores on the student's account, **send `gameId`, `runId` and `ledger` to the .NET API and recompute the score
   on the server**. The browser result is display data only. The rules:
   - Process the ledger in order; only the first unresolved checkpoint may change.
   - An unsafe action marks the checkpoint `unsafe_seen`.
   - A safe action marks it `resolved_pristine` (full weight), or `resolved_recovered` after an unsafe attempt (weight × 0.6).
   - Pass means all six checkpoints are resolved and the score is ≥ 70.
   - Reject unknown ids, repeated `eventId`s, and a `runId` the server did not issue.
   - Port `src/game/assessment.ts` (about 100 lines) to C# and test it against `src/data/scoring-fixtures.json`.

## Security and privacy (keep these)
- The game posts only to the origin given in `?parentOrigin=`; the component sets it and accepts messages only from the
  game's origin **and** its iframe window. Never use `'*'`.
- The nickname is display-only. Identify students by the platform session.
- All content is fictional (`*.internal` addresses, simulated codes). `npm run validate` blocks real-looking links.
- CSP for the game page:
  - `script-src 'self'`
  - `img-src 'self' blob: data:`
  - `media-src 'self' blob:`
  - `connect-src 'self'`
  - `worker-src 'self' blob:`
  - the platform page needs `frame-src` for the game's origin.

## Building from source (only if you change the game)
```bash
npm ci
npm test            # scoring
npm run build       # validate + typecheck + dist/
npm run dev         # http://localhost:5173  (add ?demo=gate&to=400 for a dev-only jump to a gate)
```

## Status (honest)
Tested in Chromium:
- **Viewports:** 375×812 portrait and desktop.
- **Full races:** all safe answers, one to five unsafe answers with second chances, a wrong pit choice then the right one.
- **Scores:** 100, 94, 88, 80 and 60, each checked by hand against the rules.
- **Results screen and messages:** the results screen, and `game.completed` posted only to the parent origin from an iframe
  (production build).

**Not tested yet:**
- real iPhone (Safari) and Android (Chrome): frame rate, touch feel, sound after the first tap;
- landscape on phones;
- the platform's own page.

Test on real phones before releasing to students.
