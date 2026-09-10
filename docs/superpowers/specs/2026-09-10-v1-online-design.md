# Plane V1 Online Design

## Goal

Turn the existing local hot-seat prototype into a real two-device online game while preserving the tested 10x10 plane rules and keeping the server authoritative over hidden information.

## Scope

V1 online includes: create room, six-character room code, shareable invite URL, second player join, independent placement on each device, ready state, random first player, real-time turn updates, server-side attack resolution, reconnection with a persistent player token, finish state, and mutual rematch.

V1 online does not include accounts, matchmaking, chat, spectators, rankings, persistent match history, or a database.

## Architecture

The existing `src/game/*` modules remain the only source of truth for plane geometry and attack rules. A new `RoomStore` domain module owns room lifecycle and calls the game engine once both players are ready. The HTTP server exposes JSON commands and a Server-Sent Events stream. The online browser client keeps only its own placement locally until submission and renders a sanitized room view returned by the server.

The transport uses HTTP JSON + SSE instead of adding Socket.IO in this milestone. The user-visible behavior remains real-time: every accepted mutation broadcasts a fresh room view immediately, and browser EventSource reconnects automatically after transient disconnects. This keeps V1 zero-dependency and fully testable in the current environment. The room domain is transport-agnostic so Socket.IO can replace SSE later without changing game rules.

## Room lifecycle

`WAITING` -> `PLACEMENT` -> `PLAYING` -> `FINISHED`.

- Creating a room allocates player A and returns `{ roomId, playerId, token }`.
- Joining allocates player B and moves the room to `PLACEMENT`.
- Each player submits exactly three legal planes. Submission does not make the player ready automatically.
- Each player explicitly marks ready. When both are ready, the server creates the game and randomly chooses the first player.
- During `PLAYING`, only the current player may attack an untried coordinate.
- Destroying the third enemy plane moves the room to `FINISHED`.
- Both players may vote for rematch. Two votes reset fleets, ready flags, game state, and rematch votes, returning to `PLACEMENT`.

## Identity and reconnect

Each player receives an unguessable random token. The browser stores `{ roomId, playerId, token }` in localStorage. Every room API command requires the token. Reloading the page reuses that token and fetches the current sanitized room view. Tokens are never included in opponent-visible state.

## Public room view

The server returns a player-specific view. It may contain:

- room id and room status;
- caller player id;
- whether each seat exists, is ready, and is connected;
- the caller's own submitted fleet;
- current player id during battle;
- attacks already visible to both participants;
- destroyed opponent plane footprints only after their heads have been hit;
- winner id after finish;
- rematch votes.

It must never expose an undestroyed opponent plane head, direction, body coordinates, or full `GameState.players` structure.

## HTTP API

- `POST /api/rooms` creates a room.
- `POST /api/rooms/:roomId/join` joins player B.
- `GET /api/rooms/:roomId/state?token=...` returns the caller-specific public room view.
- `POST /api/rooms/:roomId/fleet` with `{ token, planes }` submits or replaces the caller fleet before ready.
- `POST /api/rooms/:roomId/ready` with `{ token }` marks the caller ready.
- `POST /api/rooms/:roomId/attack` with `{ token, x, y }` attacks one coordinate.
- `POST /api/rooms/:roomId/rematch` with `{ token }` votes for another round.
- `GET /api/rooms/:roomId/events?token=...` opens an SSE stream and pushes `state` events whenever the room changes.

All JSON endpoints return `{ ok: true, ... }` on success and `{ ok: false, error: { code, message } }` on expected rule failures.

## Server validation and errors

The server rejects unknown rooms, invalid tokens, a third joiner, actions in the wrong room phase, invalid fleets, ready without a fleet, attacks from the wrong player, out-of-board coordinates, duplicate attacks, and rematch before finish. Rejected commands do not mutate room state.

## Connection tracking

The HTTP layer tracks active SSE streams by room/player. A player is connected when at least one valid SSE stream exists for their token. Opening or closing a stream triggers a state broadcast so the opponent can see connection state. A heartbeat comment is sent periodically to keep reverse proxies from closing idle streams.

## Room lifetime

Rooms are memory-only in V1. Each room records last activity. A cleanup pass deletes rooms that have had no API or stream activity for six hours. Server restarts therefore clear rooms; persistent rooms are intentionally deferred until Redis/database work.

## Online browser flow

The online entry page supports three starts: create room, join by code, or open an invite URL containing the room code. After identity is obtained, it stores the token and opens the SSE stream.

During placement, the client reuses the existing geometry helpers for preview, rotation, reset, and random legal fleet generation. It submits the full fleet only to the server for the current authenticated player. Once ready, the player waits for the opponent. During battle, the client renders only public state, uses two-step attack confirmation on mobile, and disables attacks when it is not the caller's turn. On finish it shows winner, revealed public information, and a rematch button.

## Invite URL

V1 uses `/online.html?room=ABC123`. Creating a room shows the room code plus a copyable absolute invite URL based on `location.origin`.

## Testing

Room-domain tests cover create/join, legal and illegal placement, readiness, first-player creation, wrong-turn rejection, attack propagation, hidden-information sanitization, finish, rematch, and token reconnect. HTTP integration tests start the real Node server on an ephemeral port and exercise create/join/state/fleet/ready/attack plus an SSE broadcast. Existing geometry/game tests remain unchanged and must stay green.

## Acceptance criteria

Two browser sessions can create/join the same room, deploy three aircraft independently without seeing the opponent fleet, ready up, receive a random first turn, alternate attacks with immediate updates, reconnect after refresh using the stored token, finish after three destroyed heads, and mutually start a rematch. No API response leaks an undestroyed opponent plane position.