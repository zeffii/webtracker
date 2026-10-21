// The build stamp: { build, commit, date }. build is the newest number in CHANGELOG.md ("## 285 · 2026-10-21", an older "## m284" counts too),
// commit the short SHA (with a "+" when the working tree has uncommitted changes), date the commit's date.
// Run as `node scripts/stamp.mjs <dir>` to write <dir>/version.json (the Pages workflow does); serve.mjs imports versionInfo().
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

export function versionInfo() {
  let build = 0;
  try { build = Number(/^## m?(\d+)/m.exec(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'))?.[1]) || 0; } catch {}
  let commit = process.env.GITHUB_SHA?.slice(0, 7) || '', date = new Date().toISOString();
  try {
    commit ||= git('rev-parse', '--short', 'HEAD');
    date = git('log', '-1', '--format=%cI');
    if (git('status', '--porcelain')) commit += '+';
  } catch {}
  return { build, commit: commit || 'unknown', date };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = join(resolve(process.argv[2] ?? '.'), 'version.json');
  const info = versionInfo();
  writeFileSync(out, `${JSON.stringify(info)}\n`);
  console.log(`${out}: ${JSON.stringify(info)}`);
}
