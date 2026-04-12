globalThis.$state = Object.assign(
  (value) => value,
  {
    eager: (value) => value,
    raw: (value) => value,
    snapshot: (value) => value,
  },
);
