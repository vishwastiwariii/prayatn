import { describe, expect, it } from 'vitest';
import { generateDataset } from './dataset';

describe('generateDataset', () => {
  it('is fully deterministic for a seed', () => {
    const a = generateDataset(20260828, 500);
    const b = generateDataset(20260828, 500);
    expect(JSON.stringify(a.payments)).toBe(JSON.stringify(b.payments));
    expect(JSON.stringify([...a.truth.entries()])).toBe(JSON.stringify([...b.truth.entries()]));
    expect(a.methodBreakdown).toEqual(b.methodBreakdown);
    expect(a.scenarioBreakdown).toEqual(b.scenarioBreakdown);
  });

  it('a different seed produces a different batch', () => {
    const a = generateDataset(1, 200);
    const b = generateDataset(2, 200);
    expect(JSON.stringify(a.payments)).not.toBe(JSON.stringify(b.payments));
  });

  it('produces exactly `count` payments with unique ids and a truth per payment', () => {
    const d = generateDataset(20260828, 500);
    expect(d.payments).toHaveLength(500);
    expect(new Set(d.payments.map((p) => p.id)).size).toBe(500);
    expect(d.truth.size).toBe(500);
    for (const p of d.payments) expect(d.truth.has(p.id)).toBe(true);
  });

  it('has a realistic payment-method distribution (~45/30/10/10/5)', () => {
    const { methodBreakdown: m } = generateDataset(20260828, 500);
    const total = 500;
    expect(m.CARD / total).toBeGreaterThan(0.38);
    expect(m.CARD / total).toBeLessThan(0.52);
    expect(m.UPI / total).toBeGreaterThan(0.24);
    expect(m.UPI / total).toBeLessThan(0.36);
    expect(m.NETBANKING / total).toBeGreaterThan(0.05);
    expect(m.NETBANKING / total).toBeLessThan(0.16);
    expect(m.MANDATE / total).toBeGreaterThan(0.05);
    expect(m.MANDATE / total).toBeLessThan(0.16);
    expect(m.WALLET / total).toBeGreaterThan(0.02);
    expect(m.WALLET / total).toBeLessThan(0.1);
  });

  it('exercises all 8 hidden scenarios', () => {
    const { scenarioBreakdown } = generateDataset(20260828, 500);
    for (const k of Object.keys(scenarioBreakdown)) {
      expect(scenarioBreakdown[k as keyof typeof scenarioBreakdown]).toBeGreaterThan(0);
    }
  });

  it('amounts are positive whole rupees (multiples of 100 minor units)', () => {
    for (const p of generateDataset(3, 100).payments) {
      expect(p.amountMinor).toBeGreaterThan(0);
      expect(p.amountMinor % 100).toBe(0);
      expect(p.salaryDay).toBeGreaterThanOrEqual(1);
      expect(p.salaryDay).toBeLessThanOrEqual(28);
    }
  });
});
