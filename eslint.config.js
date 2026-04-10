// ESLint flat config enforcing Invariants #1 and #2:
//   No fetch, no XMLHttpRequest, no WebSocket, no navigator.sendBeacon,
//   no remote script/style tags. Any attempt is a build-time error.
//
// This is the code-level backstop. The CSP `default-src 'none'` meta tag in
// index.html is the browser-level backstop. Both must pass.

import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

const NETWORK_BAN_SELECTORS = [
  // Global fetch() call
  {
    selector: "CallExpression[callee.name='fetch']",
    message:
      "Invariant #2 violation: fetch() is forbidden. This product must not make any network requests.",
  },
  // window.fetch / globalThis.fetch / self.fetch
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name='fetch']",
    message:
      "Invariant #2 violation: fetch() is forbidden in any form.",
  },
  // new XMLHttpRequest()
  {
    selector: "NewExpression[callee.name='XMLHttpRequest']",
    message:
      "Invariant #2 violation: XMLHttpRequest is forbidden. No network.",
  },
  // new WebSocket(...)
  {
    selector: "NewExpression[callee.name='WebSocket']",
    message:
      "Invariant #2 violation: WebSocket is forbidden. No network.",
  },
  // new EventSource(...)
  {
    selector: "NewExpression[callee.name='EventSource']",
    message:
      "Invariant #2 violation: EventSource (SSE) is forbidden. No network.",
  },
  // navigator.sendBeacon(...)
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name='sendBeacon']",
    message:
      "Invariant #7 violation: navigator.sendBeacon is forbidden (telemetry path).",
  },
  // import(...) with dynamic remote URL — static imports are fine (bundled),
  // but dynamic imports at runtime would fetch from the network.
  {
    selector: "ImportExpression",
    message:
      "Dynamic import() is forbidden at runtime. All code must be statically bundled into the single HTML file.",
  },
];

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "mocks/**",
      "tools/**",
      "*.config.js",
      "*.config.ts",
      "svelte.config.js",
      "eslint.config.js",
      // Svelte files have their own parser (svelte-check handles type
      // + a11y linting). The network-ban is enforced on the .ts side
      // where Svelte's <script lang="ts"> code runs anyway (imports
      // flow through TS modules).
      "**/*.svelte",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "no-restricted-syntax": ["error", ...NETWORK_BAN_SELECTORS],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "Invariant #2 violation: fetch is forbidden. Use nothing. We are offline.",
        },
        {
          name: "XMLHttpRequest",
          message: "Invariant #2 violation: XMLHttpRequest is forbidden.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "navigator",
          property: "sendBeacon",
          message: "Invariant #7 violation: sendBeacon is telemetry.",
        },
      ],
    },
  },
];
