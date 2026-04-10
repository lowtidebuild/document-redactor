/**
 * Svelte 5 entry point — mounts the single top-level `App` component
 * into `#app` and exposes nothing else.
 *
 * This file is intentionally minimal. All UI logic lives in components,
 * all engine logic lives in sibling modules (`../detection`, `../docx`,
 * `../propagation`, `../finalize`). `main.ts` is the seam between the
 * browser DOM and everything else.
 */

import { mount } from "svelte";

import App from "./App.svelte";

const target = document.getElementById("app");
if (target === null) {
  throw new Error("missing #app mount point in index.html");
}

// `mount` is the Svelte 5 runes-mode entry (replaces `new App({ target })`).
mount(App, { target });
