Recovery Desk — CLAUDE.md

1. Project Overview

You are building Recovery Desk, a payment-failure recovery orchestration platform.

One-line product definition

Recovery Desk diagnoses failed payments, determines a bounded recovery strategy, safely schedules recovery actions, and measures whether those decisions recover more money with fewer attempts than naive retry logic.

The project is primarily a fintech infrastructure + reliability + decision-engineering system.

It is NOT primarily an AI chatbot.

The core engineering value comes from:

* deterministic payment-failure classification
* deterministic recovery policies
* delayed retry orchestration
* issuer/payment simulation
* baseline-vs-agent experimentation
* idempotency
* circuit breakers
* guardrails
* append-only audit logs
* measurable recovery metrics
* AI-assisted communication and explanation only

⸻

2. Core Product Principle

The most important architectural rule is:

Never allow an LLM to directly decide or execute a financial action.

The LLM may:

1. Generate customer-facing messages.
2. Generate merchant-facing explanations.
3. Suggest classifications for unknown failure descriptions.
4. Produce low-confidence hypotheses for human review.

The LLM must NOT:

* decide whether a payment should be retried
* decide when a payment should be retried
* authorize a payment attempt
* bypass attempt limits
* bypass customer contact limits
* disable guardrails
* bypass a circuit breaker
* override a mandate-revoked hard stop
* directly call a payment execution function
* modify financial records

All financial/recovery decisions must flow through deterministic code.

⸻

3. Product Goal

Recovery Desk should answer:

“A payment failed. Why did it fail, what are we allowed to do about it, when should we do it, and did that decision actually improve recovery?”

The system must distinguish between failures such as:

* insufficient funds
* issuer temporary failure
* gateway failure
* 3DS/authentication abandonment
* UPI timeout
* expired card
* mandate revoked
* unknown/unmapped failure

The system must NOT blindly retry every failure.

⸻

4. Target Architecture

Use the following architecture:

Payment Failure Source
        |
        v
Failure Ingestion
        |
        v
Failure Normalization
        |
        v
PostgreSQL
        |
        v
Deterministic Root Cause Classifier
        |
        v
Policy Engine
        |
        +------------------+
        |                  |
        v                  v
   Recovery Queue      Human Review
        |
        v
Recovery Worker
        |
        +-------------------+
        |                   |
        v                   v
    Guardrails        Circuit Breaker
        |                   |
        +---------+---------+
                  |
                  v
          Idempotency Layer
                  |
                  v
       Payment / Issuer Simulator
                  |
                  v
          Recovery Outcome
                  |
       +----------+-----------+
       |          |           |
       v          v           v
    Metrics     Audit         AI
       |          |           |
       +----------+-----------+
                  |
                  v
          Operations Dashboard

⸻

5. Recommended Technology Stack

Unless there is a strong technical reason to change it, use:

Frontend

* Next.js
* TypeScript
* Tailwind CSS
* shadcn/ui
* Recharts
* TanStack Query

Backend

* Node.js
* TypeScript
* Fastify
* Zod
* Prisma

Data

* PostgreSQL
* Redis

Queues

* BullMQ

Infrastructure

* Docker
* Docker Compose

Testing

* Vitest
* Supertest or equivalent HTTP testing
* Playwright for critical frontend flows

⸻

6. Repository Structure

Use this structure:

recovery-desk/
│
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── domain/
│   ├── classifier/
│   ├── policy-engine/
│   ├── simulator/
│   ├── shared/
│   └── config/
│
├── workers/
│   ├── recovery-worker/
│   ├── payment-worker/
│   └── simulation-worker/
│
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
│
├── scripts/
│   ├── generate-failures.ts
│   ├── run-baseline.ts
│   └── run-agent.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docker-compose.yml
├── package.json
└── CLAUDE.md

Keep core domain logic independent of the frontend and HTTP framework.

⸻

7. Development Method

Build incrementally.

Do NOT attempt to implement the entire system in one pass.

Use this development sequence:

Phase 1  → Foundation
Phase 2  → Domain Models
Phase 3  → Database
Phase 4  → Failure Ingestion
Phase 5  → Seed Dataset
Phase 6  → Root Cause Classifier
Phase 7  → Policy Engine
Phase 8  → Recovery Queue
Phase 9  → Recovery Worker
Phase 10 → Issuer Simulator
Phase 11 → Baseline Engine
Phase 12 → Agent Experiment
Phase 13 → Metrics
Phase 14 → Guardrails
Phase 15 → Circuit Breaker
Phase 16 → Audit System
Phase 17 → AI Layer
Phase 18 → Dashboard
Phase 19 → Failure Injection
Phase 20 → End-to-End Testing
Phase 21 → Demo Mode

After completing each phase:

1. Run tests.
2. Run type checking.
3. Run linting.
4. Verify database migrations.
5. Verify the application starts.
6. Verify the phase manually if applicable.
7. Do not proceed if the current phase is broken.

⸻

8. Phase 1 — Foundation

Set up:

Next.js
Fastify
PostgreSQL
Redis
Docker Compose
TypeScript

Create:

GET /health

Expected:

{
  "status": "ok",
  "service": "recovery-desk"
}

Verify:

Web       ✓
API       ✓
Postgres  ✓
Redis     ✓

Do not build business logic yet.

⸻

9. Phase 2 — Domain Models

Define strong TypeScript types.

Payment Methods

type PaymentMethod =
  | "CARD"
  | "UPI"
  | "NETBANKING"
  | "WALLET"
  | "MANDATE";

Failure Sources

type FailureSource =
  | "CUSTOMER"
  | "BANK"
  | "GATEWAY"
  | "BUSINESS";

Failure Steps

type FailureStep =
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "CAPTURE";

Recovery Status

type RecoveryStatus =
  | "FAILED"
  | "CLASSIFIED"
  | "SCHEDULED"
  | "RETRYING"
  | "RECOVERED"
  | "HARD_STOPPED"
  | "EXHAUSTED"
  | "HUMAN_REVIEW";

Root Causes

type RootCause =
  | "CUSTOMER_FUNDS_LOW"
  | "CUSTOMER_AUTH_FAILURE"
  | "CUSTOMER_ABANDONMENT"
  | "ISSUER_TEMPORARY_FAILURE"
  | "GATEWAY_FAILURE"
  | "PAYMENT_METHOD_INVALID"
  | "MANDATE_INVALID"
  | "UNKNOWN";

Keep domain types centralized.

⸻

10. Phase 3 — Database

Use PostgreSQL + Prisma.

Create at minimum:

customers

id
name
email
phone
balance_state
salary_day
preferred_language
created_at

payments

id
customer_id
amount
currency
method
status
attempt_count
created_at
updated_at

payment_failures

id
payment_id
error_code
error_reason
error_source
error_step
error_description
raw_payload
occurred_at

classifications

id
failure_id
cause
confidence
classifier_version
classification_source
evidence
created_at

recovery_actions

id
payment_id
cause
action
scheduled_for
attempt_number
status
idempotency_key
created_at
executed_at

recovery_outcomes

id
action_id
status
amount_recovered
gateway_latency
failure_reason
occurred_at

audit_events

id
payment_id
event_type
what_we_saw
what_we_concluded
what_was_allowed
what_we_did
what_happened
metadata
created_at

Audit events must be append-only.

⸻

11. Phase 4 — Failure Ingestion

Implement:

POST /api/payments/failures

Example:

{
  "paymentId": "pay_123",
  "amount": 2500,
  "method": "card",
  "error": {
    "code": "BAD_REQUEST_ERROR",
    "reason": "insufficient_funds",
    "source": "bank",
    "step": "authorization",
    "description": "Insufficient funds"
  }
}

Validate every request with Zod.

Store the raw failure payload.

Support idempotency.

Require:

Idempotency-Key

Duplicate ingestion must not create duplicate payment failures or recovery workflows.

⸻

12. Phase 5 — Synthetic Dataset

Generate approximately:

500 payment failures

Use a realistic payment-method distribution.

Example:

CARD          ~45%
UPI           ~30%
NETBANKING    ~10%
MANDATE       ~10%
WALLET         ~5%

Include realistic failure types:

insufficient_funds
issuer_timeout
authentication_failed
3ds_abandoned
gateway_timeout
gateway_5xx
expired_card
mandate_revoked
upi_collect_timeout

Use deterministic seeds.

The experiment dataset must be reproducible.

Never generate different random datasets for the baseline and Recovery Desk comparison.

⸻

13. Phase 6 — Deterministic Root Cause Classifier

Build:

packages/classifier/

The classifier must be deterministic.

Input:

PaymentFailure

Output:

{
  cause: RootCause;
  confidence: number;
  ruleId: string;
  evidence: string[];
}

Example:

{
  "cause": "ISSUER_TEMPORARY_FAILURE",
  "confidence": 0.97,
  "ruleId": "BANK_TIMEOUT_001",
  "evidence": [
    "source=bank",
    "reason=timeout",
    "step=authorization"
  ]
}

Implement rules for:

Insufficient funds

reason == insufficient_funds
→ CUSTOMER_FUNDS_LOW

Issuer timeout

source == bank
AND reason contains timeout
→ ISSUER_TEMPORARY_FAILURE

Gateway failure

source == gateway
AND failure indicates 5xx
→ GATEWAY_FAILURE

Expired card

reason == expired_card
→ PAYMENT_METHOD_INVALID

Mandate revoked

reason == mandate_revoked
→ MANDATE_INVALID

Unknown failures:

→ UNKNOWN

Do not use an LLM for normal classification.

⸻

14. Phase 7 — Policy Engine

Create:

packages/policy-engine/

Input:

classification
payment
customer
system state

Output:

{
  action:
    | "RETRY"
    | "WAIT"
    | "SWITCH_RAIL"
    | "MESSAGE"
    | "HARD_STOP"
    | "HUMAN_REVIEW";
  delayMinutes?: number;
  maxAttempts?: number;
  reason: string;
}

Policies:

CUSTOMER_FUNDS_LOW

WAIT

Retry during expected balance window.

ISSUER_TEMPORARY_FAILURE

RETRY
delay = 18 minutes

GATEWAY_FAILURE

WAIT

Respect circuit breaker state.

3DS abandonment

MESSAGE

Prompt the customer to retry authentication.

UPI timeout

SWITCH_RAIL

Offer an alternate UPI flow.

Expired card

HARD_STOP

Mandate revoked

HARD_STOP

Cancel all future retries.

UNKNOWN

HUMAN_REVIEW

Never automatically retry an unknown failure.

⸻

15. Phase 8 — Recovery Queue

Use:

Redis + BullMQ

Create:

recovery-actions

Delayed jobs must support:

T+18 minutes

or whatever the deterministic policy specifies.

Example job:

{
  "paymentId": "pay_123",
  "actionId": "action_456",
  "attempt": 2
}

Persist the action in PostgreSQL before or alongside queue scheduling so the system can recover from worker crashes.

⸻

16. Phase 9 — Recovery Worker

Worker lifecycle:

Receive Job
    ↓
Load payment
    ↓
Check current payment state
    ↓
Check kill switch
    ↓
Check attempt limit
    ↓
Check customer limits
    ↓
Check circuit breaker
    ↓
Check idempotency
    ↓
Execute simulated payment
    ↓
Record outcome
    ↓
Update metrics
    ↓
Write audit event

The worker must never blindly trust a stale queue message.

Re-check safety conditions immediately before execution.

⸻

17. Phase 10 — Issuer / Payment Simulator

Build a deterministic simulator.

The simulator contains hidden state.

Example:

interface IssuerState {
  bank: string;
  outageWindows: OutageWindow[];
  customerBalanceTimeline: BalanceEvent[];
  deadCards: string[];
  gatewayHealth: GatewayHealth;
}

Examples:

HDFC outage
minute 0 → minute 22

Customer:

Balance = ₹500
Payment = ₹2,000
Salary date = 1st

Before balance recovery:

FAIL

After balance recovery:

SUCCESS

Dead card:

Always FAIL

The simulator should expose its configuration on the UI.

⸻

18. Phase 11 — Baseline Engine

Create the naive retry strategy.

Baseline behavior:

Any retryable failure
    ↓
Immediate retry
    ↓
Immediate retry
    ↓
Immediate retry
    ↓
STOP

The baseline must NOT use Recovery Desk’s classifier or policy engine.

It is intentionally dumb.

The baseline exists only to establish a measurable comparison.

⸻

19. Phase 12 — Recovery Desk Experiment

Both systems must process:

THE SAME SEEDED DATASET

Architecture:

Frozen Dataset
     |
     +------> Baseline
     |
     +------> Recovery Desk

Same:

* customers
* payments
* failure timestamps
* issuer state
* gateway state
* random seed
* failure conditions

Only the recovery strategy changes.

Persist experiment results.

⸻

20. Phase 13 — Metrics

Calculate at minimum:

Recovery Rate

successful recoveries
---------------------
eligible failed payments

Amount Recovered

sum(successful payment amounts)

Attempts Consumed

sum(all payment attempts)

Cost per Recovery

retry/gateway cost
------------------
successful recoveries

Customer Messages

total messages sent

Hard Stops

correctly blocked future attempts

Human Review

unknown / low-confidence failures

Never hard-code experiment results into the UI.

All numbers shown must come from actual experiment output.

⸻

21. Phase 14 — Guardrails

Implement real backend guardrails.

Maximum Attempts

Example:

MAX_ATTEMPTS = 3

Customer Contact Ceiling

Example:

MAX_MESSAGES_PER_DAY = 2

Quiet Hours

Example:

22:00 → 08:00

No customer messaging during quiet hours.

Amount/Risk Limits

Automated recovery should be bounded by configurable risk thresholds.

Mandate Kill Switch

If a mandate becomes revoked:

Cancel queued retries
Cancel scheduled retries
Block new retries

The hard stop must happen in backend execution logic, not only in the UI.

⸻

22. Phase 15 — Circuit Breaker

Implement:

CLOSED
OPEN
HALF_OPEN

Normal:

CLOSED

If gateway 5xx rate exceeds the configured threshold:

CLOSED
 ↓
OPEN

While OPEN:

Do not send new retry attempts.

After cooldown:

OPEN
 ↓
HALF_OPEN
 ↓
Probe
 ↓
Success
 ↓
CLOSED

or:

HALF_OPEN
 ↓
Failure
 ↓
OPEN

Circuit breaker state must be shared across workers.

Use Redis for distributed state.

⸻

23. Phase 16 — Append-Only Audit Log

Every recovery decision must create an audit event.

Required structure:

WHAT WE SAW
WHAT WE CONCLUDED
WHAT WE WERE ALLOWED TO DO
WHAT WE DID
WHAT HAPPENED

Example:

WHAT WE SAW:
Bank authorization timeout.
WHAT WE CONCLUDED:
Temporary issuer failure.
WHAT WE WERE ALLOWED TO DO:
Retry after 18 minutes, maximum 3 attempts.
WHAT WE DID:
Scheduled retry for 10:20.
WHAT HAPPENED:
Payment recovered at 10:20.

Never mutate previous audit records.

Create a timeline view in the UI.

⸻

24. Phase 17 — AI Layer

Only implement AI after the deterministic system is working.

Create:

POST /api/ai/customer-message
POST /api/ai/explain-failure
POST /api/ai/classify-unknown

Customer Messages

Input:

{
  "cause": "ISSUER_TEMPORARY_FAILURE",
  "language": "hinglish",
  "amount": 2500
}

Generate a concise, appropriate message.

⸻

Merchant Explanation

Given structured evidence, generate a plain-English explanation.

Example:

"Most recent failures are concentrated around temporary issuer authorization failures. Immediate retries are unlikely to succeed, so Recovery Desk is delaying retries."

The LLM should only explain facts already available to the system.

Do not let it invent metrics or financial events.

⸻

Unknown Failure Classification

For unknown descriptions:

Unknown error
      ↓
LLM suggestion
      ↓
Confidence
      ↓
Human review

Example:

{
  "suggestedCause": "ISSUER_TEMPORARY_FAILURE",
  "confidence": 0.61,
  "action": "HUMAN_REVIEW"
}

Even if the LLM suggests a retryable category, it cannot execute the retry automatically.

⸻

25. Phase 18 — Dashboard

Build a professional fintech operations dashboard.

Main page:

RECOVERY DESK
Payment Recovery Control Room

Show:

Amount Recovered
Recovery Rate
Attempts
Messages
Hard Stops
Human Review

⸻

Failure Breakdown

Display:

Issuer Failure
Funds Low
3DS Abandoned
Gateway Failure
Invalid Card
Mandate Revoked
Unknown

Use charts only where they add value.

⸻

26. Recovery Queue UI

Show real-time recovery actions.

Example:

Payment #1842
₹2,500
Issuer temporary failure
Retry in:
11m 32s
Attempt:
1 / 3

Hard stop:

Payment #1941
₹8,000
Mandate revoked
HARD STOPPED

Human review:

Payment #2018
₹1,200
Unknown failure
HUMAN REVIEW

⸻

27. Decision Inspector

Clicking a payment should expose:

Payment
Amount
Method
Failure
Root Cause
Confidence
Rule
Evidence
Decision
Delay
Attempt Limit
Guardrails
Current Status

Example:

ROOT CAUSE
ISSUER_TEMPORARY_FAILURE
Confidence:
97%
Rule:
BANK_TIMEOUT_001
DECISION:
RETRY
Delay:
18 minutes
Max Attempts:
3
Guardrails:
✓ Attempt limit
✓ Idempotency
✓ Quiet hours
✓ Contact ceiling
✓ Gateway health

⸻

28. Audit Timeline

Show:

10:02:13
Payment failed
10:02:13
Classified as issuer temporary failure
10:02:14
Retry scheduled
10:20:01
Retry executed
10:20:03
Payment recovered
10:20:03
₹2,500 recovered

This should directly map to persisted audit events.

⸻

29. Phase 19 — Failure Injection

Create demo controls:

INJECT GATEWAY 5XX STORM
INJECT HDFC ISSUER OUTAGE
INJECT UPI TIMEOUT SPIKE
SIMULATE CUSTOMER BALANCE RECOVERY
REVOKE MANDATE
MARK CARD DEAD

These controls must affect the simulator state.

Do not fake the dashboard response.

⸻

30. Phase 20 — Simulator Configuration UI

Show:

SIMULATOR PARAMETERS
Dataset Seed:
20260828
HDFC outage:
0 → 22 minutes
Salary cycle:
1st
Gateway 5xx threshold:
20%
Circuit cooldown:
60 seconds
Max attempts:
3
Max customer messages:
2/day

The goal is transparency.

The simulator must not secretly change its behavior to produce better Recovery Desk results.

⸻

31. Phase 21 — Experiment Dashboard

Create a dedicated comparison screen.

Example:

BASELINE vs RECOVERY DESK
                    BASELINE     RECOVERY DESK
Payments                500             500
Recovered              ₹X              ₹Y
Recovery Rate          X%              Y%
Attempts               X               Y
Messages               X               Y
Hard Stops             0               X
Human Review           0               X

Calculate improvement dynamically.

Examples:

+XX% recovered value
-XX% attempts
-XX% messages

Never fabricate these numbers.

⸻

32. Human Review Queue

Show:

Payment #1928
₹4,200
Unknown error:
"Authorization response mismatch..."
AI suggestion:
ISSUER_TEMPORARY_FAILURE
Confidence:
61%
[ ACCEPT ]
[ REJECT ]

If accepted:

classification_source = HUMAN

Persist the human decision.

Create an audit event.

⸻

33. Testing Requirements

Unit Tests

Test:

classifier
policy engine
guardrails
idempotency
circuit breaker
metrics
simulator

Examples:

insufficient_funds
→ CUSTOMER_FUNDS_LOW
issuer_timeout
→ ISSUER_TEMPORARY_FAILURE
mandate_revoked
→ HARD_STOP

⸻

Idempotency Test

Execute the same action twice.

Expected:

first → executes
second → duplicate blocked

⸻

Circuit Breaker Test

Inject enough 5xx errors.

Expected:

CLOSED → OPEN

Then recover gateway.

Expected:

OPEN → HALF_OPEN → CLOSED

⸻

Attempt Limit Test

Try to execute attempt #4 when max attempts is 3.

Expected:

BLOCKED

⸻

Mandate Test

Revoke mandate while retry exists in the queue.

Expected:

queued retry → cancelled/blocked

⸻

34. End-to-End Test

Test:

Failure
 ↓
Ingestion
 ↓
Classification
 ↓
Policy
 ↓
Queue
 ↓
Worker
 ↓
Guardrails
 ↓
Simulator
 ↓
Outcome
 ↓
Audit
 ↓
Metrics
 ↓
Dashboard

A single payment should be traceable from failure to final outcome.

⸻

35. Demo Mode

Create:

/demo

The demo should have four scenarios.

Scenario 1 — Smart Recovery

Payment fails
→ Diagnose
→ Schedule delayed retry
→ Recover

Scenario 2 — Gateway Storm

Inject 5xx storm
→ Circuit breaker opens
→ Queue pauses
→ Gateway recovers
→ Circuit closes
→ Queue resumes

Scenario 3 — Hard Stop

Mandate revoked
→ Future retries cancelled
→ Hard stop

Scenario 4 — Experiment

500 seeded failures
→ Baseline
→ Recovery Desk
→ Compare results

⸻

36. Critical Demo Narrative

Use this story:

“Most payment systems treat failure as a binary event. Recovery Desk treats it as a diagnosis problem.”

Then demonstrate:

Payment failed
       ↓
Why?
       ↓
Issuer temporary failure
       ↓
What are we allowed to do?
       ↓
Retry in 18 minutes
       ↓
Guardrails checked
       ↓
Retry executes
       ↓
Payment recovered

Then:

“Notice that the model did not decide to retry the payment. The deterministic policy engine did.”

Then demonstrate the gateway storm.

Then show the baseline comparison.

⸻

37. Final Architecture Principle

The system should clearly separate:

DECISION

from:

EXECUTION

and:

EXPLANATION

Specifically:

Classifier
    ↓
Policy Engine
    ↓
Decision
    ↓
Guardrails
    ↓
Execution
    ↓
Outcome
    ↓
AI Explanation

Never:

LLM
 ↓
"Maybe retry?"
 ↓
Payment

⸻

38. Security and Reliability Rules

Always:

* validate external input
* use idempotency keys
* use database transactions where required
* make workers safe to retry
* use append-only audit events
* never expose secrets to frontend
* never trust client-side guardrails
* enforce limits server-side
* use environment variables for credentials
* sanitize LLM-generated output before rendering
* avoid logging sensitive payment/customer data unnecessarily

⸻

39. Code Quality Rules

Use:

* strict TypeScript
* small pure functions for classification and policy logic
* explicit domain types
* Zod for external validation
* meaningful error types
* structured logging
* dependency injection where useful
* unit tests for financial decision logic

Avoid:

* giant service classes
* business logic inside React components
* business logic directly inside route handlers
* hidden global state
* hard-coded experiment results
* random non-reproducible simulations
* LLM-dependent financial decisions

⸻

40. Definition of Done

Recovery Desk is considered demo-ready only when all of these work:

[ ] Failure ingestion works
[ ] Razorpay-style failure payloads are supported
[ ] 500+ deterministic synthetic failures exist
[ ] Root cause classifier works
[ ] Classification has confidence + evidence
[ ] Policy engine works
[ ] Retry scheduling works
[ ] Recovery worker works
[ ] Issuer simulator works
[ ] Baseline engine works
[ ] Same dataset runs against both systems
[ ] Metrics are calculated dynamically
[ ] Idempotency works
[ ] Attempt limits work
[ ] Customer contact limits work
[ ] Quiet hours work
[ ] Mandate kill switch works
[ ] Circuit breaker works
[ ] Gateway 5xx injection works
[ ] Queue pauses/resumes correctly
[ ] Append-only audit log works
[ ] Human review works
[ ] AI customer messaging works
[ ] AI merchant explanation works
[ ] AI unknown classification works
[ ] AI cannot execute financial actions
[ ] Dashboard works
[ ] Recovery queue works
[ ] Decision inspector works
[ ] Audit timeline works
[ ] Baseline comparison works
[ ] Demo mode works
[ ] Unit tests pass
[ ] Integration tests pass
[ ] E2E tests pass
[ ] Docker deployment works

⸻

41. Important Development Instructions for Claude

When implementing this project:

DO

* Build one phase at a time.
* Inspect the existing code before modifying it.
* Reuse existing abstractions.
* Write tests alongside business logic.
* Keep financial decisions deterministic.
* Make simulation reproducible.
* Persist important state.
* Make workers idempotent.
* Explain architectural tradeoffs in code comments when non-obvious.
* Verify each phase before moving forward.

DO NOT

* Build fake dashboard metrics.
* hard-code successful recovery numbers.
* allow the LLM to make financial decisions.
* use random non-seeded simulations.
* bypass guardrails for the demo.
* silently retry payments.
* hide simulator parameters.
* fabricate Razorpay settlement/payment behavior.
* skip tests because the feature “looks simple”.
* move business logic into the frontend.
* create mock success responses that bypass the actual simulator.

⸻

42. Priority Order

When forced to choose between features, prioritize:

1. Correct financial decision logic
2. Idempotency
3. Guardrails
4. Simulator correctness
5. Baseline comparison
6. Metrics correctness
7. Auditability
8. Reliability / circuit breaker
9. AI features
10. UI polish

A correct backend with a simple UI is better than a beautiful dashboard sitting on fake logic.

⸻

43. Final Product Philosophy

Recovery Desk should demonstrate three things:

1. Judgment

The system understands that:

failure ≠ failure

Different failures require different actions.

2. Safety

The system understands:

recover money

must never become:

retry forever

Every action is bounded.

3. Measurement

The system proves its value experimentally:

Same failures
     ↓
Baseline vs Recovery Desk
     ↓
Measured difference

The strongest final message is:

“We don’t use AI to decide whether to charge a customer. We use deterministic policies to make that decision safely, and AI only helps humans understand the system and communicate with customers.”

Build toward that principle throughout the entire project.