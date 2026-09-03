import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { RULES } from './rules';
import type { ClassifierInput } from './types';

const SAMPLES: ClassifierInput[] = [
  {
    errorCode: 'BAD_REQUEST_ERROR',
    errorReason: 'insufficient_funds',
    errorSource: 'BANK',
    errorStep: 'AUTHORIZATION',
    errorDescription: 'Insufficient funds in account',
    method: 'CARD',
  },
  {
    errorCode: 'GATEWAY_ERROR',
    errorReason: 'issuer_timeout',
    errorSource: 'BANK',
    errorStep: 'AUTHORIZATION',
    errorDescription: 'Issuer did not respond within the authorization window',
    method: 'CARD',
  },
  {
    errorCode: 'BAD_REQUEST_ERROR',
    errorReason: 'mandate_revoked',
    errorSource: 'BUSINESS',
    errorStep: 'AUTHORIZATION',
    errorDescription: 'Customer has revoked the e-mandate',
    method: 'MANDATE',
  },
  {
    errorCode: 'X',
    errorReason: 'totally_unmapped_reason',
    errorSource: 'GATEWAY',
    errorStep: 'CAPTURE',
    errorDescription: '',
    method: 'WALLET',
  },
];

describe('determinism', () => {
  it('classify() is a pure function: 200 runs give a deep-equal result', () => {
    for (const sample of SAMPLES) {
      const first = JSON.stringify(classify(sample));
      for (let i = 0; i < 200; i += 1) {
        expect(JSON.stringify(classify(sample))).toBe(first);
      }
    }
  });

  it('confidence is always a fixed 2-decimal number in (0, 1]', () => {
    for (const sample of SAMPLES) {
      const { confidence } = classify(sample);
      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThanOrEqual(1);
      expect(Number(confidence.toFixed(2))).toBe(confidence);
    }
  });

  it('no rule explanation or description is prescriptive (diagnosis only)', () => {
    const forbidden = /\b(retry|re-try|wait|delay|schedule|switch rail|hard[- ]?stop|escalate)\b/i;
    for (const rule of RULES) {
      expect(rule.description).not.toMatch(forbidden);
    }
    for (const sample of SAMPLES) {
      // winning-rule descriptions are echoed into the explanation; the extra
      // machinery text ("Matched rule ...") must also stay non-prescriptive.
      const { explanation } = classify(sample);
      expect(explanation).not.toMatch(forbidden);
    }
  });

  it('result never contains a recovery action field', () => {
    const r = classify(SAMPLES[0] as ClassifierInput);
    expect(r).not.toHaveProperty('action');
    expect(r).not.toHaveProperty('recoveryAction');
    expect(r).not.toHaveProperty('decision');
  });
});
