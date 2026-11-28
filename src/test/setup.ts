import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

expect.extend(axeMatchers);

afterEach(() => {
  cleanup();
});

if (typeof window !== 'undefined' && typeof globalThis.Request === 'function') {
  try {
    // Detecta incompatibilidade de realm entre AbortSignal do jsdom 31 e Request nativo (undici) no Node 22/24
    new globalThis.Request('http://localhost/', { signal: new AbortController().signal });
  } catch {
    const NativeRequest = globalThis.Request;

    class JsdomCompatibleRequest extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        if (init?.signal !== undefined && init.signal !== null) {
          const { signal: _jsdomSignal, ...restInit } = init;
          super(input, restInit);
          return;
        }
        super(input, init);
      }
    }

    Object.defineProperty(globalThis, 'Request', {
      writable: true,
      configurable: true,
      value: JsdomCompatibleRequest,
    });
  }
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (typeof window !== 'undefined' && typeof globalThis.ResizeObserver !== 'function') {
  class JsdomResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: JsdomResizeObserver,
  });
}
