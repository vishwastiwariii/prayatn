import { describe, expect, it } from 'vitest';
import { SERVICE_NAME } from './index';

describe('shared', () => {
  it('exposes the canonical service name', () => {
    expect(SERVICE_NAME).toBe('recovery-desk');
  });
});
