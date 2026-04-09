const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  MutationObserver: 'readonly',
  URL: 'readonly',
  self: 'readonly',
  navigator: 'readonly',
  chrome: 'readonly',
  browser: 'readonly',
  importScripts: 'readonly',
};

const SHARED_JS_GLOBALS = {
  CSM_CONFIG: 'readonly',
  STORAGE_KEYS: 'readonly',
  STATUS_COLOR: 'readonly',
  STATUS_PRIORITY: 'readonly',
  ERROR_CODES: 'readonly',
  ERROR_LABELS: 'readonly',
  SHARED_STATUS_LABELS: 'readonly',
  getOverallColor: 'readonly',
  csmEl: 'readonly',
};

export default [
  // shared.js defines the globals — don't treat them as pre-existing
  {
    files: ['src/shared.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: BROWSER_GLOBALS,
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'off',
    },
  },
  // All other src files consume shared.js globals
  {
    files: ['src/**/*.js'],
    ignores: ['src/shared.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...BROWSER_GLOBALS,
        ...SHARED_JS_GLOBALS,
      },
    },
    rules: {
      // Errors
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-duplicate-case': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      'no-debugger': 'error',

      // Best practices
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-with': 'error',
      'no-caller': 'error',
      'no-throw-literal': 'error',

      // DOM safety (AMO compliance)
      'no-restricted-properties': ['error',
        { object: 'document', property: 'write', message: 'Use DOM API methods instead.' },
        { property: 'innerHTML', message: 'Use textContent or DOM API for AMO compliance.' },
        { property: 'outerHTML', message: 'Use DOM API methods instead.' },
      ],

      // Style (warn only)
      'no-var': 'warn',
      'prefer-const': ['warn', { destructuring: 'all' }],
    },
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: [
      'claude-status-extension-firefox-v3/**',
      'claude-status-extension-chrome-v3/**',
      'dist/**',
      'node_modules/**',
    ],
  },
];
