# Plane V1 AI + Deploy Design

## Goal

Complete V1 by adding a non-cheating AI practice mode with three difficulty levels and packaging the whole application for repeatable Docker deployment and CI verification.

## Scope

V1 AI includes: difficulty selection, player placement, random legal AI placement, random first player, alternating human/AI attacks, finish state, full reveal after finish, and restart.

V1 deployment includes: production Dockerfile, `.dockerignore`, optional `docker-compose.yml`, container health check, environment-configurable `PORT`, CI for tests/build/container build, and deployment documentation.

The scope does not add accounts, persistence, matchmaking, chat, rankings, telemetry, Redis, or a database.

## AI fairness boundary

The AI must never receive or inspect the human player's actual fleet. Its decision API accepts only public attack history and board size, equivalent to information available to a human opponent.

The game controller may hold the real human fleet because it is responsible for applying attacks through the existing game engine, but the controller passes only sanitized attack observations to the AI decision function.

## Difficulty levels

### Easy

Choose uniformly from coordinates the AI has not attacked before. It does not infer aircraft geometry.

### Normal

Prefer coordinates near previous `HIT` results. It scores untried cells by proximity to unresolved hits and otherwise falls back to an untried coordinate. It never uses hidden fleet data.

### Hard

Enumerate all single-plane placements on the 10x10 board for all four orientations. Eliminate candidates inconsistent with the AI's public observations:

- a `MISS` coordinate cannot belong to a candidate;
- a destroyed plane footprint is treated as resolved and excluded from unresolved inference;
- unresolved `HIT` coordinates increase a candidate's score when they belong to that candidate;
- already attacked coordinates are never selected again.

For every remaining candidate, accumulate probability weight on its untried cells. Prefer head cells because hitting a head immediately destroys a plane, then use body probability as a secondary signal. Ties are broken by the injected random source so tests remain deterministic.

This is deliberately a practical V1 probabilistic solver rather than a full global three-plane constraint solver. It still reasons from legal plane shapes without cheating and remains fast in-browser.

## AI interfaces

Create `src/ai/ai.ts` with:

```ts
export type AiDifficulty = 'EASY' | 'NORMAL' | 'HARD';

export interface AiObservation {
  position: Position;
  kind: 'MISS' | 'HIT' | 'DESTROYED';
  revealedCells?: PlaneCell[];
}

export function chooseAiAttack(
  difficulty: AiDifficulty,
  observations: AiObservation[],
  random?: () => number,
): Position;
```

`chooseAiAttack` is pure from the caller's perspective and has no parameter that can carry the hidden human fleet.

Create `src/ai/session.ts` for the local human-vs-AI state machine. It owns the two fleets and existing `GameState`, derives AI observations only from `game.attacks` plus revealed destroyed footprints, calls `chooseAiAttack`, then applies the selected coordinate through the existing `attack()` game rule.

## Browser flow

Add `/ai.html` and `src/web/ai.ts`.

Flow:

1. Choose Easy / Normal / Hard.
2. Deploy exactly three legal aircraft using the existing placement interaction.
3. Start battle; AI receives a random legal fleet and the existing game engine chooses first player.
4. Human uses two-step coordinate confirmation.
5. When it is AI's turn, the client calls the AI session once and renders the result immediately after a short UI-safe transition; no background worker is required in V1.
6. Finish after all three heads are destroyed, reveal both complete fleets, and offer restart.

## Deployment architecture

Use a multi-stage Dockerfile:

- builder stage: Node 22 image, install dependencies, run tests, run TypeScript build;
- runtime stage: Node 22 slim/alpine image, copy only `dist`, `scripts`, and package metadata needed to run the zero-dependency server;
- expose port 4173;
- configure `HEALTHCHECK` against `/health` using Node's built-in `fetch` so no curl/wget dependency is required;
- run as a non-root Node user where supported by the base image.

Because the runtime server has no third-party runtime dependencies, the final image does not need `node_modules`.

## CI

Add `.github/workflows/ci.yml` triggered on pushes to `dev/v1-core` and pull requests to `main`.

Jobs:

1. Checkout.
2. Setup Node 22 with npm cache.
3. `npm ci` when a lockfile exists, otherwise `npm install`.
4. `npm test`.
5. `npm run build`.
6. `docker build -t plane-ci .`.

CI does not publish images in V1; it proves the repository is buildable and containerizable.

## Acceptance criteria

- Easy, Normal, and Hard modes never select an already attacked coordinate.
- No AI API accepts the player's real fleet.
- Hard mode demonstrably changes choices based on MISS/HIT evidence.
- Human-vs-AI can complete a full legal game and detect a winner.
- `/ai.html` is served by the existing server and works with the same responsive UI system.
- Existing local and online modes remain intact.
- Full test suite passes.
- TypeScript build passes.
- Docker image builds from repository root.
- Running the container serves `/`, `/online.html`, `/ai.html`, and `/health`.
- GitHub CI runs on the development branch / PR and verifies tests, build, and Docker build.
