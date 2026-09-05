-- CreateEnum
CREATE TYPE "RecoveryMessageSource" AS ENUM ('AI', 'FALLBACK');

-- AlterTable
ALTER TABLE "recovery_actions" ADD COLUMN     "requiresCustomerMessage" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "recovery_messages" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "recoveryActionId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "language" "PreferredLanguage" NOT NULL,
    "content" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" "RecoveryMessageSource" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_messages_recoveryActionId_key" ON "recovery_messages"("recoveryActionId");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_messages_idempotencyKey_key" ON "recovery_messages"("idempotencyKey");

-- CreateIndex
CREATE INDEX "recovery_messages_paymentId_idx" ON "recovery_messages"("paymentId");

-- AddForeignKey
ALTER TABLE "recovery_messages" ADD CONSTRAINT "recovery_messages_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_messages" ADD CONSTRAINT "recovery_messages_recoveryActionId_fkey" FOREIGN KEY ("recoveryActionId") REFERENCES "recovery_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
