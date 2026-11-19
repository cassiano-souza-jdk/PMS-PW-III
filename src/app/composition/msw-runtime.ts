import type { SetupWorker } from 'msw/browser';
import { createMswHandlers, type MswCompositionDependencies } from './msw-handlers';

export interface StartBrowserMswWorkerOptions {
  readonly serviceWorkerUrl?: string;
  readonly quiet?: boolean;
}

/**
 * Dynamically imports `msw/browser` and starts the Service Worker with `onUnhandledRequest: 'bypass'`
 * so static assets, fonts, and SPA navigation routes are never blocked (ADR-0003, ADR-0007 §5.2).
 */
export async function startBrowserMswWorker(
  deps: MswCompositionDependencies,
  options: StartBrowserMswWorkerOptions = {},
): Promise<SetupWorker> {
  const { setupWorker } = await import('msw/browser');
  const handlers = createMswHandlers(deps);
  const worker = setupWorker(...handlers);

  await worker.start({
    serviceWorker: {
      url: options.serviceWorkerUrl ?? '/mockServiceWorker.js',
    },
    onUnhandledRequest: 'bypass',
    quiet: options.quiet ?? true,
  });

  return worker;
}
