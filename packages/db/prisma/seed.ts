import { prismaClient } from '../src/client';

/**
 * Phase 3 seed: verifies the connection and the schema is migrated.
 * The deterministic synthetic dataset (~500 failures) is generated in Phase 5.
 */
async function main(): Promise<void> {
  await prismaClient.$queryRaw`SELECT 1`;
  const customers = await prismaClient.customer.count();
  console.log(
    `[db:seed] connection OK, schema reachable (customers table has ${customers} rows). ` +
      'No seed data inserted in Phase 3.',
  );
}

main()
  .catch((err) => {
    console.error('[db:seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prismaClient.$disconnect();
  });
