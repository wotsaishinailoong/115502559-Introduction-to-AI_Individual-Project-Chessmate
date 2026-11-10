import { mkdir, copyFile, readdir } from 'node:fs/promises';
const source = 'node_modules/stockfish/src';
await mkdir('public/engine', { recursive: true });
for (const name of await readdir(source)) {
  if (name.includes('lite-single') && /\.(js|wasm)$/.test(name)) await copyFile(`${source}/${name}`, `public/engine/${name}`);
}

await copyFile('node_modules/stockfish/Copying.txt', 'public/engine/COPYING.txt');
await copyFile('node_modules/stockfish/AUTHORS', 'public/engine/AUTHORS.txt');
