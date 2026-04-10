<!--
  Minimal footer — credit line at the bottom of the app shell.

  Intentionally tiny and unobtrusive. No links (keeps the app 100%
  self-contained — no clickable paths out to the network, even if
  the user initiates them). Plain text.

  Placed in the grid by `App.svelte` as row 3, spanning all columns.
-->
<script lang="ts">
  // This component takes no props and has no state — the empty
  // TypeScript block exists so svelte-check can emit a module
  // declaration for the importer (`App.svelte`).
</script>

<footer class="footer">
  Built by lowtidebuild
</footer>

<style>
  .footer {
    grid-column: 1 / -1;
    grid-row: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px 16px;
    border-top: 1px solid var(--border);
    background: var(--surface);
    color: var(--ink-muted);
    font-size: 11px;
    letter-spacing: 0.02em;
    user-select: none;
  }
</style>
