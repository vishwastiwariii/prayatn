# @recovery-desk/db

Owns everything database: the Prisma schema, migrations, the generated client,
and the repository (persistence) layer.

```
Domain types (@recovery-desk/domain)
        │
        ▼
prisma/schema.prisma
        │  prisma migrate
        ▼
PostgreSQL  ◄─ docker compose (host port 5442)
        │  prisma generate → src/generated/client (git-ignored)
        ▼
src/client.ts         singleton PrismaClient  → export { prismaClient }
src/repositories/*     typed persistence layer → export { repositories, create* }
src/transaction.ts     withTransaction(fn)
```

## Usage

```ts
import { prismaClient, repositories, withTransaction, createRepositories } from '@recovery-desk/db';

const payment = await repositories.payments.findByIdWithRelations(id);

await withTransaction(async (tx) => {
  const repos = createRepositories(tx);
  await repos.recoveryActions.cancelOpenForPayment(paymentId);
  await repos.auditEvents.append({/* ... */});
});
```

Generated enums / row types (`PaymentMethod`, `RootCause`, `Payment`, `Prisma`, …)
are re-exported from the package root.

## Scripts (run from repo root or this package)

| Command                                          | Purpose                                             |
| ------------------------------------------------ | --------------------------------------------------- |
| `pnpm --filter @recovery-desk/db generate`       | regenerate the client (also runs on `pnpm install`) |
| `pnpm --filter @recovery-desk/db migrate`        | create + apply a dev migration                      |
| `pnpm --filter @recovery-desk/db migrate:deploy` | apply committed migrations (prod/CI)                |
| `pnpm --filter @recovery-desk/db studio`         | open Prisma Studio                                  |
| `pnpm --filter @recovery-desk/db seed`           | connectivity check (real dataset = Phase 5)         |
| `pnpm --filter @recovery-desk/db test`           | repository integration tests (needs DB)             |

`DATABASE_URL` is read from the repo-root `.env` via `dotenv-cli`.
