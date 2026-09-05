# Prayatn

### Intelligent Payment Failure Recovery & Bounded Retry Orchestration

Prayatn is a payment recovery system that answers a simple question:

> **A payment failed. Should we retry it, wait, change the approach, or stop?**

Instead of blindly retrying every failed payment, Prayatn first understands **why the payment failed**, applies a deterministic recovery policy, schedules the appropriate action, and safely executes it.

It is designed around one principle:

**A payment failure is a diagnosis problem, not a retry button.**

## What Prayatn Does

When a payment fails, Prayatn:

1. Ingests and normalizes the failure
2. Classifies its root cause
3. Decides the safest recovery strategy
4. Schedules the action through a recovery queue
5. Protects the payment gateway with a circuit breaker
6. Executes bounded, idempotent recovery attempts
7. Communicates with the customer when appropriate
8. Sends uncertain cases to human review
9. Records every decision in an audit trail
10. Compares its results against a naive retry strategy

The system supports failures such as insufficient funds, authentication failures, customer abandonment, temporary issuer failures, gateway failures, invalid payment methods, and revoked mandates.

## Architecture

```text
                         ┌──────────────────────┐
                         │      Web Dashboard    │
                         │ Recovery + Analytics  │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │       Fastify API     │
                         │ Ingestion / Decisions │
                         └──────────┬───────────┘
                                    │
                    ┌───────────────┼────────────────┐
                    │               │                │
                    ▼               ▼                ▼
             ┌────────────┐ ┌──────────────┐ ┌─────────────┐
             │ Classifier │ │ Policy Engine│ │  AI Layer   │
             │   "Why?"   │ │    "What?"   │ │  "Explain"  │
             └──────┬─────┘ └──────┬───────┘ └─────────────┘
                    │               │
                    └───────┬───────┘
                            ▼
                    ┌──────────────┐
                    │  PostgreSQL  │
                    │ Source of    │
                    │ Truth        │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ BullMQ/Redis │
                    │ Recovery     │
                    │ Queue        │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Recovery   │
                    │    Worker    │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Circuit    │
                    │   Breaker    │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Payment    │
                    │  Simulator   │
                    │ / Gateway    │
                    └──────────────┘
```

In simple terms:

**Classifier** understands the failure.

**Policy Engine** decides what should happen.

**BullMQ + Redis** decides when the action should run.

**Recovery Worker** executes the approved action.

**Circuit Breaker** prevents recovery attempts from overwhelming an unhealthy gateway.

**PostgreSQL** stores payments, failures, decisions, outcomes, and the complete audit trail.

**AI** is deliberately limited to customer messages, merchant explanations, and suggestions for unknown failures. It never makes financial recovery decisions.

**Dashboard** shows the entire system in real time, including recovery activity, gateway health, decisions, audits, and evaluation results.


## Tech Stack

**Frontend:** Next.js, TypeScript, Tailwind CSS, shadcn/ui, Recharts

**Backend:** Node.js, Fastify, TypeScript, Zod

**Data & Infrastructure:** PostgreSQL, Prisma, Redis, BullMQ, Docker

**AI:** OpenAI API with deterministic fallbacks and strict output validation

**Testing:** Vitest, Playwright


## Project Structure

```text
prayatn/
├── apps/
│   ├── web/              Dashboard
│   └── api/              Backend API
│
├── packages/
│   ├── domain/           Core domain models
│   ├── classifier/       Failure classification
│   ├── policy-engine/    Recovery decisions
│   ├── simulator/        Payment simulation
│   ├── evaluation/       Naive vs Prayatn
│   ├── circuit-breaker/  Gateway protection
│   ├── ai/               Messaging & explanations
│   └── shared/           Shared utilities
│
├── workers/
│   └── recovery/         Recovery job execution
│
├── datasets/             Frozen simulation data
├── docs/                 Architecture & demo documentation
└── prisma/               Database schema & migrations
```

## Running Prayatn

```bash
pnpm install

docker compose up -d

pnpm db:migrate
pnpm db:seed

pnpm dev
```

Then open the dashboard and run the demo.

## The Idea

Most payment systems treat failure as:

```text
FAIL → RETRY → RETRY → RETRY
```

Prayatn treats it as:

FAIL
 ↓
UNDERSTAND
 ↓
DECIDE
 ↓
WAIT / RETRY / SWITCH / MESSAGE / STOP
 ↓
RECOVER
