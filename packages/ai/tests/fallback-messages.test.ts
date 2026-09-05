import type { RootCause } from '@recovery-desk/domain';
import { describe, expect, it } from 'vitest';
import { fallbackMessageFor } from '../src/fallback-messages';

const ALL_CAUSES: RootCause[] = [
  'CUSTOMER_FUNDS_LOW',
  'CUSTOMER_AUTH_FAILURE',
  'CUSTOMER_ABANDONMENT',
  'ISSUER_TEMPORARY_FAILURE',
  'GATEWAY_FAILURE',
  'PAYMENT_METHOD_INVALID',
  'MANDATE_INVALID',
  'UNKNOWN',
];

describe('fallbackMessageFor', () => {
  it.each(ALL_CAUSES)('has a non-empty EN fallback for %s', (cause) => {
    const msg = fallbackMessageFor(cause, 'EN');
    expect(msg.length).toBeGreaterThan(0);
  });

  it.each(ALL_CAUSES)('has a non-empty HINGLISH fallback for %s', (cause) => {
    const msg = fallbackMessageFor(cause, 'HINGLISH');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('every cause has a distinct EN message', () => {
    const messages = new Set(ALL_CAUSES.map((c) => fallbackMessageFor(c, 'EN')));
    expect(messages.size).toBe(ALL_CAUSES.length);
  });

  it('defaults to EN when no language given', () => {
    expect(fallbackMessageFor('ISSUER_TEMPORARY_FAILURE')).toBe(
      fallbackMessageFor('ISSUER_TEMPORARY_FAILURE', 'EN'),
    );
  });

  it('never invents a refund, discount, deadline, or guarantee', () => {
    const banned = ['refund', 'discount', 'guarantee', 'promise', 'definitely'];
    for (const cause of ALL_CAUSES) {
      const en = fallbackMessageFor(cause, 'EN').toLowerCase();
      for (const word of banned) {
        expect(en).not.toContain(word);
      }
    }
  });
});
