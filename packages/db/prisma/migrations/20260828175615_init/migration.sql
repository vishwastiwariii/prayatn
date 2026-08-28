-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'UPI', 'NETBANKING', 'WALLET', 'MANDATE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'FAILED', 'RECOVERING', 'SUCCEEDED', 'EXHAUSTED', 'HARD_STOPPED');

-- CreateEnum
CREATE TYPE "FailureSource" AS ENUM ('CUSTOMER', 'BANK', 'GATEWAY', 'BUSINESS');

-- CreateEnum
CREATE TYPE "FailureStep" AS ENUM ('AUTHENTICATION', 'AUTHORIZATION', 'CAPTURE');

-- CreateEnum
CREATE TYPE "RecoveryStatus" AS ENUM ('FAILED', 'CLASSIFIED', 'SCHEDULED', 'RETRYING', 'RECOVERED', 'HARD_STOPPED', 'EXHAUSTED', 'HUMAN_REVIEW');

-- CreateEnum
CREATE TYPE "RootCause" AS ENUM ('CUSTOMER_FUNDS_LOW', 'CUSTOMER_AUTH_FAILURE', 'CUSTOMER_ABANDONMENT', 'ISSUER_TEMPORARY_FAILURE', 'GATEWAY_FAILURE', 'PAYMENT_METHOD_INVALID', 'MANDATE_INVALID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RecoveryActionType" AS ENUM ('RETRY', 'WAIT', 'SWITCH_RAIL', 'MESSAGE', 'HARD_STOP', 'HUMAN_REVIEW');

-- CreateEnum
CREATE TYPE "RecoveryActionStatus" AS ENUM ('PENDING', 'SCHEDULED', 'EXECUTING', 'EXECUTED', 'CANCELLED', 'BLOCKED', 'FAILED');

-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('RULE', 'LLM_SUGGESTION', 'HUMAN');

-- CreateEnum
CREATE TYPE "RecoveryOutcomeStatus" AS ENUM ('SUCCESS', 'FAILED', 'BLOCKED', 'DUPLICATE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PreferredLanguage" AS ENUM ('EN', 'HI', 'HINGLISH');

-- CreateEnum
CREATE TYPE "CustomerBalanceState" AS ENUM ('HEALTHY', 'LOW', 'CRITICAL', 'UNKNOWN');

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "balanceState" "CustomerBalanceState" NOT NULL DEFAULT 'UNKNOWN',
    "salaryDay" INTEGER,
    "preferredLanguage" "PreferredLanguage" NOT NULL DEFAULT 'EN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "recoveryStatus" "RecoveryStatus",
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_failures" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "errorCode" TEXT NOT NULL,
    "errorReason" TEXT NOT NULL,
    "errorSource" "FailureSource" NOT NULL,
    "errorStep" "FailureStep" NOT NULL,
    "errorDescription" TEXT NOT NULL,
    "rawPayload" JSONB,
    "idempotencyKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classifications" (
    "id" TEXT NOT NULL,
    "failureId" TEXT NOT NULL,
    "cause" "RootCause" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "ruleId" TEXT,
    "classifierVersion" TEXT NOT NULL,
    "source" "ClassificationSource" NOT NULL DEFAULT 'RULE',
    "evidence" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_actions" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "cause" "RootCause" NOT NULL,
    "action" "RecoveryActionType" NOT NULL,
    "status" "RecoveryActionStatus" NOT NULL DEFAULT 'PENDING',
    "attemptNumber" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "reason" TEXT,
    "delayMinutes" INTEGER,
    "maxAttempts" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "recovery_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_outcomes" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "status" "RecoveryOutcomeStatus" NOT NULL,
    "amountRecovered" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gatewayLatencyMs" INTEGER,
    "failureReason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "eventType" TEXT NOT NULL,
    "whatWeSaw" TEXT NOT NULL,
    "whatWeConcluded" TEXT NOT NULL,
    "whatWasAllowed" TEXT NOT NULL,
    "whatWeDid" TEXT NOT NULL,
    "whatHappened" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE INDEX "payments_customerId_idx" ON "payments"("customerId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_recoveryStatus_idx" ON "payments"("recoveryStatus");

-- CreateIndex
CREATE UNIQUE INDEX "payment_failures_idempotencyKey_key" ON "payment_failures"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_failures_paymentId_idx" ON "payment_failures"("paymentId");

-- CreateIndex
CREATE INDEX "payment_failures_errorReason_idx" ON "payment_failures"("errorReason");

-- CreateIndex
CREATE INDEX "payment_failures_occurredAt_idx" ON "payment_failures"("occurredAt");

-- CreateIndex
CREATE INDEX "classifications_failureId_idx" ON "classifications"("failureId");

-- CreateIndex
CREATE INDEX "classifications_cause_idx" ON "classifications"("cause");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_actions_idempotencyKey_key" ON "recovery_actions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "recovery_actions_paymentId_idx" ON "recovery_actions"("paymentId");

-- CreateIndex
CREATE INDEX "recovery_actions_status_scheduledFor_idx" ON "recovery_actions"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_outcomes_actionId_key" ON "recovery_outcomes"("actionId");

-- CreateIndex
CREATE INDEX "recovery_outcomes_status_idx" ON "recovery_outcomes"("status");

-- CreateIndex
CREATE INDEX "recovery_outcomes_occurredAt_idx" ON "recovery_outcomes"("occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_paymentId_idx" ON "audit_events"("paymentId");

-- CreateIndex
CREATE INDEX "audit_events_eventType_idx" ON "audit_events"("eventType");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_failures" ADD CONSTRAINT "payment_failures_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_failureId_fkey" FOREIGN KEY ("failureId") REFERENCES "payment_failures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_actions" ADD CONSTRAINT "recovery_actions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_outcomes" ADD CONSTRAINT "recovery_outcomes_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "recovery_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
