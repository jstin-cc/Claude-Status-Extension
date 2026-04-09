#!/usr/bin/env node

/**
 * Build script for Claude Status Monitor.
 * Syncs src/ to extension directories, generates browser-specific manifests,
 * and optionally creates dist/ ZIPs.
 *
 * Usage:
 *   node scripts/build.js            # sync + generate manifests for both
 *   node scripts/build.js --firefox   # Firefox only
 *   node scripts/build.js --chrome    # Chrome only
 *   node scripts/build.js --zip       # also create dist/ ZIPs
 */

import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Config ──────────────────────────────────────────────────

const SHARED_FILES = [
  'shared.js', 'content.js', 'content.css',
  'popup.js', 'popup.html', 'popup.css', 'background.js',
];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version.replace(/\.0$/, ''); // 3.0.0 → 3.0

// ── Manifest definitions ────────────────────────────────────

const MANIFEST_BASE = {
  manifest_version: 3,
  name: 'Claude Status Monitor',
  version,
  description: 'Displays the real-time Anthropic service status directly on claude.ai. Supports German and English.',
  author: 'jstin-cc',
  homepage_url: 'https://github.com/jstin-cc/Claude-Status-Firefox-Extension',
  action: {
    default_popup: 'popup.html',
    default_icon: {
      '16': 'icons/icon-16.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },
  permissions: ['alarms', 'tabs', 'storage', 'notifications'],
  host_permissions: [
    'https://claude.ai/*',
    'https://status.anthropic.com/*',
  ],
  content_scripts: [{
    matches: ['https://claude.ai/*'],
    js: ['shared.js', 'content.js'],
    css: ['content.css'],
    run_at: 'document_idle',
  }],
  icons: {
    '16': 'icons/icon-16.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
};

const FIREFOX_OVERRIDES = {
  background: {
    scripts: ['shared.js', 'background.js'],
  },
  browser_specific_settings: {
    gecko: {
      id: 'claude-status-monitor@jstin-cc',
      strict_min_version: '140.0',
      data_collection_permissions: {
        required: ['none'],
        optional: [],
      },
    },
    gecko_android: {
      strict_min_version: '142.0',
    },
  },
};

const CHROME_OVERRIDES = {
  background: {
    service_worker: 'background.js',
  },
};

const TARGETS = {
  firefox: {
    dir: 'claude-status-extension-firefox-v3',
    overrides: FIREFOX_OVERRIDES,
    zipName: `claude-status-monitor-${version}.zip`,
  },
  chrome: {
    dir: 'claude-status-extension-chrome-v3',
    overrides: CHROME_OVERRIDES,
    zipName: `claude-status-monitor-chrome-${version}.zip`,
  },
};

// ── CLI args ────────────────────────────────────────────────

const args = process.argv.slice(2);
const doZip = args.includes('--zip');
const onlyFirefox = args.includes('--firefox');
const onlyChrome = args.includes('--chrome');

const selectedTargets = onlyFirefox
  ? ['firefox']
  : onlyChrome
    ? ['chrome']
    : ['firefox', 'chrome'];

// ── Build ───────────────────────────────────────────────────

function syncFiles(targetDir) {
  const dest = join(ROOT, targetDir);
  const src = join(ROOT, 'src');

  for (const file of SHARED_FILES) {
    copyFileSync(join(src, file), join(dest, file));
  }

  // Sync icons
  const iconsSource = join(src, 'icons');
  const iconsDest = join(dest, 'icons');
  if (existsSync(iconsSource)) {
    mkdirSync(iconsDest, { recursive: true });
    cpSync(iconsSource, iconsDest, { recursive: true });
  }
}

function generateManifest(targetDir, overrides) {
  const manifest = { ...MANIFEST_BASE, ...overrides };
  const dest = join(ROOT, targetDir, 'manifest.json');
  writeFileSync(dest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function createZip(targetDir, zipName) {
  const distDir = join(ROOT, 'dist');
  mkdirSync(distDir, { recursive: true });
  const zipPath = join(distDir, zipName);

  // Use PowerShell Compress-Archive on Windows, zip on Unix
  const source = join(ROOT, targetDir, '*');
  try {
    if (process.platform === 'win32') {
      // Remove existing zip first (Compress-Archive doesn't overwrite by default with -Force on some versions)
      execSync(`powershell -Command "if (Test-Path '${zipPath}') { Remove-Item '${zipPath}' }; Compress-Archive -Path '${source}' -DestinationPath '${zipPath}'"`, { stdio: 'pipe' });
    } else {
      execSync(`cd "${join(ROOT, targetDir)}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });
    }
    console.log(`  ZIP: ${zipName}`);
  } catch (err) {
    console.error(`  ZIP failed for ${zipName}: ${err.message}`);
  }
}

// ── Main ────────────────────────────────────────────────────

console.log(`Claude Status Monitor v${version} — Build\n`);

for (const name of selectedTargets) {
  const target = TARGETS[name];
  console.log(`[${name}] ${target.dir}`);

  syncFiles(target.dir);
  console.log(`  Synced ${SHARED_FILES.length} files + icons`);

  generateManifest(target.dir, target.overrides);
  console.log('  Manifest generated');

  if (doZip) {
    createZip(target.dir, target.zipName);
  }
}

console.log('\nDone.');
