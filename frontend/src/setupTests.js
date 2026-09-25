Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }),
});

Object.defineProperty(document, "hidden", {
  configurable: true,
  writable: true,
  value: false,
});
