import "@testing-library/jest-dom/vitest";

if (!globalThis.indexedDB) {
  const mockRequest = () => ({
    result: null,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    addEventListener: () => {},
    removeEventListener: () => {},
  });

  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    writable: true,
    value: {
      open: () => mockRequest(),
      deleteDatabase: () => mockRequest(),
    },
  });

  Object.defineProperty(globalThis, "IDBKeyRange", {
    configurable: true,
    writable: true,
    value: class IDBKeyRange {},
  });
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
