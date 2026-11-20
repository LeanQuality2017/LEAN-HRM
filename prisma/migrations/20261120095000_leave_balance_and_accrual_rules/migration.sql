-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN "isUnpaid" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LeaveAccrualRule" (
    "id" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "amount" DECIMAL(6,2) NOT NULL,
    "carryForwardCap" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "expiryMonths" INTEGER NOT NULL DEFAULT 0,
    "proRateOnJoin" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveAccrualRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "credited" DECIMAL(6,2) NOT NULL,
    "used" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "carriedForward" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "lapsed" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "lastAccruedMonth" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveAccrualRule_leaveTypeId_key" ON "LeaveAccrualRule"("leaveTypeId");

-- CreateIndex
CREATE INDEX "LeaveAccrualRule_leaveTypeId_idx" ON "LeaveAccrualRule"("leaveTypeId");

-- CreateIndex
CREATE INDEX "LeaveBalance_employeeId_year_idx" ON "LeaveBalance"("employeeId", "year");

-- CreateIndex
CREATE INDEX "LeaveBalance_leaveTypeId_idx" ON "LeaveBalance"("leaveTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_employeeId_leaveTypeId_year_key" ON "LeaveBalance"("employeeId", "leaveTypeId", "year");

-- AddForeignKey
ALTER TABLE "LeaveAccrualRule" ADD CONSTRAINT "LeaveAccrualRule_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

