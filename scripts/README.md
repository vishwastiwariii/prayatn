# scripts

- `run-experiment.ts` — baseline vs Recovery Desk experiment against the seeded
  500-payment batch + hidden-state simulator. `pnpm exp [seed] [count]`.

- `run-evaluation.ts` — the multi-seed evaluation / comparison engine (Phase 9).
  `pnpm eval [count] [seed...]`.

- `gateway-storm-demo.ts` — the Phase 10 gateway-storm timeline. Seeded payments,
  gateway healthy, then a deterministic 5xx storm; prints the per-payment trace
  (time / payment / circuit state / gateway call / result / next action), the
  reliability metrics and the audit trail. `pnpm storm [payments] [seed]`.

Everything is pure and deterministic — the same seed + config always produces the
same numbers.

- `seed-demo-payments.ts` — Phase 11 dashboard dev data. Inserts a handful of
  customers/payments directly, then drives each one through the real
  ingest -> classify -> decide -> enqueue(immediate) HTTP pipeline, so the
  live dashboard has more than the Phase 3 hand-written seed to show. Requires
  the API and the recovery worker running locally.
  `pnpm --filter @recovery-desk/db exec tsx ../../scripts/seed-demo-payments.ts`.
