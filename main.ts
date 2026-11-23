// "Palkon Auto" — packaging entrypoint for the gta6-01 competition.
//
// The game itself is plain static files: game/index.html plus its ES
// modules (handwritten WebGL 2, no library, no network request). This
// program copies game/ and screenshots/ next to this file into the
// output directory and writes output/dossier.json, the summary the
// judge reads, using the vendored make.fun library. It then prints a
// one-line packaging summary (file counts + dossier hash) to stdout,
// so a build log shows what shipped.
//
// Run it locally to check the package:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Serve the game itself with `node serve.ts`, then open http://localhost:8080.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// Resolve the repo path from this file's own URL, never from the
// process working directory — the grader runs node /bot/main.ts from
// a cwd that is not /bot.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps (reference/gate.json): only text_max_bytes
// shapes the bytes; the others refuse an entry the scorer would
// refuse — more than 4 screenshots or one over 256 KiB; more than
// 993 files in game/ or 48 MiB of game files in all, or a path under
// game/ over 1000 bytes (game/ counts beside /output's own 1000-entry
// cap, its screenshots/ and dossier.json).
const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    n += entry.isDirectory() ? countFiles(p) : 1;
  }
  return n;
}

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}
writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, DOSSIER_LIMITS));

const dossierPath = join(outputDir, 'dossier.json');
const dossierHash = createHash('sha256').update(readFileSync(dossierPath)).digest('hex');
console.log(
  `Palkon Auto packaged: ${countFiles(join(outputDir, 'game'))} game files, ` +
  `${readdirSync(join(outputDir, 'screenshots')).length} screenshots, ` +
  `dossier ${statSync(dossierPath).size} B sha256 ${dossierHash.slice(0, 16)}…`,
);
