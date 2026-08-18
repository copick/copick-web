Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { hardwareConcurrency: 1 },
});
