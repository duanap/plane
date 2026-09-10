import { cp, mkdir, rm } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await rm('dist/public', { recursive: true, force: true });
await cp('public', 'dist/public', { recursive: true });
