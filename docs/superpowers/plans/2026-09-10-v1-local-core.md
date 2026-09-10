# Plane V1 Local Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a testable Bomb Plane game engine plus a responsive browser hot-seat prototype that completes placement, alternating attacks, plane destruction, and win detection.

**Architecture:** Keep all rules in pure TypeScript modules with no UI dependencies. The browser UI consumes only public game-engine APIs, while a tiny Node HTTP server serves compiled modules and static assets. This creates a clean boundary for replacing local hot-seat state with authoritative online room state later.

**Tech Stack:** TypeScript 5.8, Node.js 22 built-in test runner and HTTP server, native HTML/CSS/ES modules.

**Spec:** Conversation-approved V1 rules: 10x10 board, exactly 3 non-overlapping planes, four rotations, 1 head + 9 body cells, one attack per turn, MISS/HIT/DESTROYED, reveal destroyed plane, first to destroy all 3 wins.

## Global Constraints

- Board size is exactly 10 x 10.
- Each player deploys exactly 3 planes.
- Plane shape is 1 head + 9 body cells; wingspan 5, length 4, tail width 3.
- Allowed directions are UP, RIGHT, DOWN, LEFT.
- Planes may touch but may not overlap or leave the board.
- Hitting the head immediately destroys the plane.
- A destroyed plane's full footprint is revealed.
- Re-attacking an attacked coordinate is rejected without consuming a turn.

---

### Task 1: Plane geometry and placement validation

**Files:**
- Create: `src/game/geometry.ts`
- Create: `src/game/types.ts`
- Test: `test/geometry.test.ts`

**Interfaces:**
- Produces: `planeCells(plane)`, `validatePlacement(planes)`, `isInsideBoard(position)`.

- [ ] Write failing tests for shape, rotations, boundaries, overlap, and adjacency.
- [ ] Run tests and confirm failure because the APIs do not exist.
- [ ] Implement the smallest pure functions that satisfy the rules.
- [ ] Run tests and confirm all geometry tests pass.

### Task 2: Attack resolution and game state

**Files:**
- Create: `src/game/game.ts`
- Test: `test/game.test.ts`

**Interfaces:**
- Consumes: geometry helpers from Task 1.
- Produces: `createGame(players)`, `attack(game, coordinate)`, and serializable public game state.

- [ ] Write failing tests for MISS, HIT, DESTROYED, duplicate attack rejection, turn switching, reveal, and win detection.
- [ ] Run tests and confirm expected failures.
- [ ] Implement immutable-enough state transitions with explicit errors.
- [ ] Run full tests and confirm pass.

### Task 3: Browser hot-seat prototype

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `src/web/main.ts`

**Interfaces:**
- Consumes: `planeCells`, `validatePlacement`, `createGame`, and `attack`.
- Produces: a responsive local two-player playable flow.

- [ ] Implement placement UI with orientation, remove/reset, and ready transition.
- [ ] Implement privacy handoff screen between players.
- [ ] Implement battle board with two-step target confirmation and visible MISS/HIT/DESTROYED marks.
- [ ] Implement finish view and restart.
- [ ] Build with `tsc` and verify output.

### Task 4: Zero-dependency local server and documentation

**Files:**
- Create: `scripts/server.mjs`
- Modify: `README.md`

**Interfaces:**
- Produces: `npm start` serving `dist/public` and compiled `/web` modules.

- [ ] Add static file server with safe path handling and `/health` JSON.
- [ ] Document build/test/start commands and current V1 scope.
- [ ] Run tests, build, start server, and smoke-test `/health` and `/`.
