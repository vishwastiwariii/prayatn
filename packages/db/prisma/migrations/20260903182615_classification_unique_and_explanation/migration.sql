-- AlterTable
ALTER TABLE "classifications" ADD COLUMN     "explanation" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "classifications_failureId_classifierVersion_key" ON "classifications"("failureId", "classifierVersion");

