import { ROOT_CAUSE_LABEL, RECOVERY_ACTION_LABEL } from '../labels';
import type { RecoveryMessageInput } from '../types';

/**
 * Phase 12 §2-4 — the AI is asked to WRITE, never to DECIDE. The prompt only
 * ever hands over an already-approved recovery action and asks for wording;
 * it never asks "should we retry".
 */
export function buildCustomerMessagePrompt(input: RecoveryMessageInput): {
  system: string;
  user: string;
} {
  const language = input.customerLanguage ?? 'EN';

  const system = [
    'You write short customer-facing messages for Recovery Desk, a payment-failure recovery system.',
    'A deterministic policy engine has ALREADY decided the recovery action below. You do not decide',
    'anything — you only phrase it for the customer.',
    '',
    'Never invent or imply:',
    '- refunds, discounts, or promises the system did not state',
    '- a deadline or exact time the payment will succeed',
    '- that the payment already succeeded',
    '- an exact bank/gateway outage duration',
    '- a guarantee that a retry will work',
    '',
    'Only communicate the facts given to you. If a fact (like a delay) is not given, do not invent one.',
    `Write in ${language === 'HINGLISH' ? 'natural, respectful Hinglish (not a mechanical translation)' : 'concise English'}.`,
    'Keep it short, respectful, and action-oriented. No corporate boilerplate, no exclamation marks.',
    'Return only the structured fields requested — no extra commentary.',
  ].join('\n');

  const facts = [
    `payment_id: ${input.paymentId}`,
    `amount: ${(input.amountMinor / 100).toFixed(2)} ${input.currency}`,
    `payment_method: ${input.paymentMethod}`,
    `root_cause: ${ROOT_CAUSE_LABEL[input.rootCause]}`,
    `approved_recovery_action: ${RECOVERY_ACTION_LABEL[input.recoveryAction]}`,
    input.delayMinutes != null ? `delay_minutes: ${input.delayMinutes}` : null,
  ]
    .filter((line): line is string => line != null)
    .join('\n');

  const user = [
    'Generate a customer message for this already-approved recovery action.',
    '',
    '<approved_facts>',
    facts,
    '</approved_facts>',
    '',
    `Target language: ${language}`,
  ].join('\n');

  return { system, user };
}
