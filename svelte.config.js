/**
 * Svelte config — used by the @sveltejs/vite-plugin-svelte plugin and
 * svelte-check (the type/a11y linter for .svelte files).
 *
 * We're running Svelte 5 in runes mode, so there is no separate
 * preprocessor configuration. TypeScript inside <script lang="ts"> is
 * handled by vite-plugin-svelte natively.
 */

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
const config = {
  compilerOptions: {
    runes: true,
  },
};

export default config;
