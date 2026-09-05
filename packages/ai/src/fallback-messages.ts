import type { RootCause } from '@recovery-desk/domain';
import type { SupportedLanguage } from './types';

/**
 * Deterministic fallback messages — Phase 12 §6.
 *
 * Recovery Desk keeps operating when the AI is unavailable, times out,
 * returns malformed output, or is rate-limited. These strings are the
 * guarantee: every root cause has one, in every supported language, with no
 * network call involved.
 */
const EN: Record<RootCause, string> = {
  CUSTOMER_FUNDS_LOW: 'Your payment could not be completed because there were insufficient funds.',
  CUSTOMER_AUTH_FAILURE: 'Your payment could not be completed because authentication was unsuccessful.',
  CUSTOMER_ABANDONMENT: 'Your payment was not completed. You can continue whenever you’re ready.',
  ISSUER_TEMPORARY_FAILURE: 'Your bank is temporarily unavailable. Please try again shortly.',
  PAYMENT_METHOD_INVALID: 'Your payment method could not be used. Please update your payment method.',
  MANDATE_INVALID: 'Your automatic payment authorization is no longer valid. Please update it.',
  GATEWAY_FAILURE: 'We’re temporarily unable to process this payment. Please try again later.',
  UNKNOWN: 'We couldn’t complete this payment. Please try again or use another payment method.',
};

const HINGLISH: Record<RootCause, string> = {
  CUSTOMER_FUNDS_LOW: 'Aapka payment complete nahi ho paya kyunki balance kam tha.',
  CUSTOMER_AUTH_FAILURE: 'Aapka payment complete nahi ho paya kyunki authentication fail ho gaya.',
  CUSTOMER_ABANDONMENT: 'Aapka payment complete nahi hua. Jab ready ho, tab continue kar sakte hain.',
  ISSUER_TEMPORARY_FAILURE:
    'Aapka bank temporarily unavailable hai. Hum thodi der baad dobara try karenge.',
  PAYMENT_METHOD_INVALID: 'Aapka payment method use nahi ho paya. Please payment method update karein.',
  MANDATE_INVALID: 'Aapka automatic payment authorization ab valid nahi hai. Please ise update karein.',
  GATEWAY_FAILURE: 'Hum abhi is payment ko process nahi kar paa rahe. Please thodi der baad try karein.',
  UNKNOWN: 'Hum ye payment complete nahi kar paaye. Please dobara try karein ya doosra method use karein.',
};

export function fallbackMessageFor(cause: RootCause, language: SupportedLanguage = 'EN'): string {
  const table = language === 'HINGLISH' ? HINGLISH : EN;
  return table[cause];
}
