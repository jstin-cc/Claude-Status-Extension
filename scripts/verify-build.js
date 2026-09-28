#!/usr/bin/env node

/**
 * Sanity check for the generated build targets (run after `npm run build`):
 * every manifest parses, carries the package.json version, and every file it
 * references exists in its target directory.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['claude-status-extension-firefox-v3', 'claude-status-extension-chrome-v3'];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const expectedVersion = pkg.version.replace(/\.0$/, '');

function referencedFiles(m) {
  return [
    m.action?.default_popup,
    ...Object.values(m.action?.default_icon ?? {}),
    ...Object.values(m.icons ?? {}),
    ...(m.background?.scripts ?? []),
    m.background?.service_worker,
    ...(m.content_scripts ?? []).flatMap((cs) => [...(cs.js ?? []), ...(cs.css ?? [])]),
  ].filter(Boolean);
}

let failed = false;
let targetFailed = false;
function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failed = true;
  targetFailed = true;
}

for (const target of TARGETS) {
  console.log(`[${target}]`);
  targetFailed = false;
  const manifestPath = join(ROOT, target, 'manifest.json');
  if (!existsSync(manifestPath)) {
    fail('manifest.json missing');
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.manifest_version !== 3) fail(`manifest_version is ${manifest.manifest_version}, expected 3`);
  if (manifest.version !== expectedVersion) fail(`version ${manifest.version}, expected ${expectedVersion}`);
  for (const file of referencedFiles(manifest)) {
    if (!existsSync(join(ROOT, target, file))) fail(`referenced file missing: ${file}`);
  }
  if (!targetFailed) console.log(`  ✓ v${manifest.version}, ${referencedFiles(manifest).length} referenced files present`);
}

if (failed) process.exit(1);
