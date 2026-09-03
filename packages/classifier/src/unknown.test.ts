import { describe, expect, it } from 'vitest';
import { classify, UNKNOWN_CONFIDENCE, UNKNOWN_RULE_ID } from './classify';
import type { ClassifierInput } from './types';

function input(over: Partial<ClassifierInput> = {}): ClassifierInput {
  return {
    errorCode: 'BAD_REQUEST_ERROR',
    errorReason: 'unspecified',
    errorSource: 'GATEWAY',
    errorStep: 'AUTHORIZATION',
    errorDescription: '',
    method: 'CARD',
    ...over,
  };
}

describe('unknown / unmapped failures are handled safely', () => {
  it('unmapped reason -> UNKNOWN with low fixed confidence and the fallback rule id', () => {
    const r = classify(input({ errorReason: 'authorization_response_mismatch' }));
    expect(r.cause).toBe('UNKNOWN');
    expect(r.confidence).toBe(UNKNOWN_CONFIDENCE);
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.ruleId).toBe(UNKNOWN_RULE_ID);
    expect(r.candidates).toEqual([]);
  });

  it('empty-ish error fields -> UNKNOWN, never throws', () => {
    const r = classify(input({ errorReason: '', errorCode: '', errorDescription: '' }));
    expect(r.cause).toBe('UNKNOWN');
    expect(r.evidence).toContain('no_rule_matched');
  });

  it('explanation states the cause could not be identified and is not prescriptive', () => {
    const r = classify(input({ errorReason: 'weird_new_provider_code' }));
    expect(r.explanation.toLowerCase()).toContain('could not be identified');
    expect(r.explanation.toLowerCase()).not.toMatch(/\bretry\b|\bwait\b|\bschedule\b|human review/);
  });

  it('gibberish that partially resembles a keyword still does not false-positive', () => {
    // "fundsxyz" is not the whole token "funds"
    const r = classify(input({ errorReason: 'fundsxyz_problem', errorSource: 'BANK' }));
    expect(r.cause).toBe('UNKNOWN');
  });
});
