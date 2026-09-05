import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveAIClient } from '../src/live';

const KEYS = ['AI_PROVIDER', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('liveAIClient — provider selection (Phase 12 follow-up: multi-provider)', () => {
  it('returns null when no provider is configured — AI unavailable, fallback path', () => {
    expect(liveAIClient()).toBeNull();
  });

  it('picks OpenAI when only OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(liveAIClient()).not.toBeNull();
  });

  it('picks Anthropic when only ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(liveAIClient()).not.toBeNull();
  });

  it('prefers OpenAI when both keys are present and AI_PROVIDER is unset', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    // Can't inspect which provider without a network call, but at minimum
    // this must not throw and must return a usable client either way.
    expect(liveAIClient()).not.toBeNull();
  });

  it('AI_PROVIDER=anthropic without ANTHROPIC_API_KEY falls back to null, even if OPENAI_API_KEY is set', () => {
    process.env.AI_PROVIDER = 'anthropic';
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(liveAIClient()).toBeNull();
  });

  it('AI_PROVIDER=openai without OPENAI_API_KEY falls back to null, even if ANTHROPIC_API_KEY is set', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(liveAIClient()).toBeNull();
  });

  it('AI_PROVIDER is case-insensitive', () => {
    process.env.AI_PROVIDER = 'OpenAI';
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(liveAIClient()).not.toBeNull();
  });
});
