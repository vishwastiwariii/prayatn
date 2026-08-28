Recovery Desk

Intelligent Payment Failure Recovery & Bounded Retry Orchestration

Don’t retry every failed payment. Diagnose it, decide what is safe, and recover intelligently.

Recovery Desk is a fintech infrastructure system that turns failed payments into diagnosed, policy-controlled recovery workflows.

Instead of blindly retrying every failed payment, Recovery Desk understands the failure reason, applies a deterministic recovery policy, schedules the appropriate action, enforces safety guardrails, and measures the outcome.

⸻

// Problem

Most payment recovery systems treat failures the same way:

Payment Failed
     ↓
Retry
     ↓
Retry
     ↓
Retry
     ↓
Give Up

But:

* Insufficient funds shouldn’t be retried 30 seconds later.
* Temporary issuer failures may succeed after waiting.
* 3DS abandonment needs customer intervention.
* Expired cards should be stopped.
* Gateway outages require a circuit breaker.
* Revoked mandates must never be retried.

Blind retries waste money, increase payment attempts, and create a poor customer experience.

⸻

 - Our Approach

Recovery Desk uses a deterministic decision pipeline:

Payment Failure
      ↓
Root-Cause Classification
      ↓
Recovery Policy
      ↓
Safety Guardrails
      ↓
Retry / Wait / Switch / Message / Stop
      ↓
Outcome + Audit

Example

Bank Timeout
     ↓
ISSUER_TEMPORARY_FAILURE
     ↓
Retry after 18 minutes
     ↓
Guardrails checked
     ↓
Retry

While:

Mandate Revoked
     ↓
MANDATE_INVALID
     ↓
HARD STOP
     ↓
Cancel future retries

⸻

// AI — Used Where It Should Be

AI is not responsible for financial decisions.

We deliberately keep:

* retry eligibility
* retry timing
* payment execution
* attempt limits
* circuit breakers
* hard stops

deterministic and policy-controlled.

AI is used for:

* customer-facing recovery messages
* merchant-facing failure explanations
* suggesting classifications for unknown errors
* assisting human review

AI can explain a financial decision. It cannot authorize one.

⸻

// Baseline vs Recovery Desk

Recovery Desk includes a deterministic payment/issuer simulator with hidden customer and issuer state.

The same seeded dataset is run through:

                 500 Failures
                     │
           ┌─────────┴─────────┐
           ↓                   ↓
      Naive Retry        Recovery Desk
           │                   │
           └─────────┬─────────┘
                     ↓
                 Compare

We measure:

 Amount recovered
 Recovery rate
 Attempts consumed
 Cost per recovery
 Customer messages
 Hard stops
 Human reviews

This turns the product from “we think our approach is better” into a measurable experiment.

⸻

// Reliability & Safety

Recovery Desk includes:

1. Idempotency keys
2. Maximum retry limits
3. Customer contact ceilings
4. Quiet hours
5. Mandate kill switch
6. Circuit breaker for gateway failures
7. Append-only audit logs
8. Human review for unknown failures

Every action can be traced as:

What we saw
→ What we concluded
→ What we were allowed to do
→ What we did
→ What happened

⸻

// Tech Stack

Frontend

 Next.js
 TypeScript
 Tailwind CSS
 shadcn/ui
 Recharts

Backend

 Node.js
 Fastify
 TypeScript
 Prisma
 Zod

Infrastructure

 PostgreSQL
 Redis
 BullMQ
 Docker

AI

 LLM API for messaging, explanations and unknown-error assistance

Testing

 Vitest
 Playwright

⸻

Demo

The demo showcases:

1. Failed payment → root-cause diagnosis
2. Intelligent delayed retry
3. Hard-stop for an unsafe payment
4. Gateway 5xx storm → circuit breaker
5. Idempotent queue replay protection
6. Baseline vs Recovery Desk experiment

⸻

Core Principle

A payment failure is a diagnosis problem, not a retry button.

Recovery Desk is designed to recover more value without turning payment recovery into uncontrolled retry automation.