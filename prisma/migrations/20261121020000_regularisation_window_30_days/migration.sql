-- AlterTable
ALTER TABLE "CompanyPayRule" ALTER COLUMN "regularisationWindowDays" SET DEFAULT 30;

-- Enforce Owner ruling 10B (fixed 30) on all existing rows
UPDATE "CompanyPayRule" SET "regularisationWindowDays" = 30;

