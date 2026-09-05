import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Without global test hooks, @testing-library/react's auto-cleanup never
// registers, so DOM from one test leaks into the next in the same file.
afterEach(cleanup);

// jsdom has no ResizeObserver and reports zero element size, which makes
// Recharts' <ResponsiveContainer> refuse to render its children.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverMock;

Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 600 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 300 });
