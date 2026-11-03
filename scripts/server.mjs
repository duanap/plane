import { fileURLToPath } from 'node:url';
import { RoomStore } from '../dist/online/room-store.js';
import { createPlaneServer } from './server-core.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const store = new RoomStore();
const server = createPlaneServer({ store, root });
server.listen(port, process.env.HOST ?? '0.0.0.0', () => console.log(`Plane running on http://localhost:${port}`));
