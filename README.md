# League of Legends Team Balancer & Stats Platform

A web app and Discord bot for running League of Legends custom games ("inhouses"): it builds fair 5v5 teams, records match results, and turns them into per-player stats and leaderboards.

**Live:** [lol-balance-gamma.vercel.app](https://lol-balance-gamma.vercel.app) — used by 8 gaming communities (280+ players, 170+ recorded matches).

## What it does

- **Team balancing.** Picks 10 players and proposes the fairest teams, lane by lane rather than by total score alone.
- **Automatic tiers.** Enter a Riot ID and the server pulls the player's current and peak ranks from op.gg's official MCP server, then maps them to a tier score.
- **Replay parsing.** Upload a `.rofl` replay file and the browser extracts the 10-player match data (KDA, gold, damage, objectives) and fills in the match record.
- **Stats.** Leaderboards, per-player profiles, champion pools, and match history, with small-sample damping so a player with two lucky games doesn't top the board.
- **Discord bot.** Slash commands for sign-up, lane-based recruiting queues, and team balancing, so players never have to leave Discord.
- **Rooms and roles.** Each community gets its own room with owner, editor, recorder, and view-only access. Visitors without a role can only read.
- **English and Korean.** The interface follows the browser language.

## How the balancer scores a split

Most balancers only compare team totals, which can produce teams that are equal on paper while one lane is badly mismatched. This engine minimizes

```
Σ (lane gap × lane weight) + total gap × totalWeight + distribution gap × 0.4
```

- **Lane weight** is each role's score spread (top, jungle, and ADC ≈ 1.0; mid 0.88; support 0.66), so a gap in a high-impact lane costs more.
- **Distribution gap** compares the teams player by player after sorting, which keeps the weakest players from landing on the same team.
- The engine also flags likely smurfs with a z-score and returns several distinct candidate splits instead of forcing one.

The engine is a pure module ([src/engine.js](src/engine.js)) with no framework dependencies.

## Architecture

| Layer | Choice |
|---|---|
| Web app | Next.js 14 (App Router), React 18 |
| Data | Supabase (PostgreSQL); schema in [supabase/schema.sql](supabase/schema.sql) |
| Discord bot | Serverless interactions endpoint ([app/api/discord/route.js](app/api/discord/route.js)) with Ed25519 signature verification, no always-on gateway process |
| Rank data | op.gg MCP server over JSON-RPC ([src/opgg.js](src/opgg.js)); Riot API as an optional fallback |
| Replay parsing | In-browser `.rofl` metadata scanner, version-independent ([src/rofl.js](src/rofl.js)) |
| Abuse protection | Rate limiting with Upstash Redis, falling back to in-memory limits ([src/ratelimit.js](src/ratelimit.js)) |
| Hosting | Vercel |

## Running locally

```bash
npm install
cp .env.local.example .env.local   # fill in your Supabase project values
npm run dev                        # http://localhost:3000
npm test                           # engine, parser, and rate-limit tests
```

Apply [supabase/schema.sql](supabase/schema.sql) to your Supabase project first. The Discord bot and op.gg lookup are optional and turn on when their environment variables are set.

## How it was built

This started in 2024 as a C++ command-line tool I wrote to balance games with friends. I rebuilt it as this web app in July 2026 using AI-assisted development (Claude Code and Codex); I designed the scoring model and data model, reviewed and tested the changes, and run it for the communities that use it.

Design notes from development (Korean): [docs/DESIGN.ko.md](docs/DESIGN.ko.md)
