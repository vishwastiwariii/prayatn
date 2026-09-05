import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

export function renderWithQueryClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Installs a `global.fetch` stub that answers by URL pathname. */
export function mockFetchByPath(handlers: Record<string, () => { status: number; body: unknown }>) {
  const fn = vi.fn(async (input: string | URL) => {
    const url = new URL(input);
    const handler = handlers[url.pathname];
    if (!handler) {
      throw new Error(`No mock handler for ${url.pathname}`);
    }
    const { status, body } = handler();
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
