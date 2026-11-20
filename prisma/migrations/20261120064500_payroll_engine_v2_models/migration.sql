-- AlterTable
ALTER TABLE "Company" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- CreateTable
CREATE TABLE "CompanyPayRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workingDaysBasis" TEXT NOT NULL DEFAULT 'CALENDAR',
    "lopDivisor" DECIMAL(5,2),
    "otMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.50,
    "payrollCutoffDay" INTEGER NOT NULL DEFAULT 25,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPayRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryStructure" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryComponent" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "isStatutory" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeSalaryRevision" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "previousBase" DECIMAL(12,2) NOT NULL,
    "newBase" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "revisedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeSalaryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryProfile" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "pfApplicable" BOOLEAN NOT NULL DEFAULT true,
    "pfCeiling" BOOLEAN NOT NULL DEFAULT true,
    "esiApplicable" BOOLEAN NOT NULL DEFAULT false,
    "ptState" TEXT NOT NULL DEFAULT 'TN',
    "tdsRegime" TEXT NOT NULL DEFAULT 'NEW',
    "declarations" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatutoryProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "runById" TEXT,
    "lockedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "totalGross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalStatutory" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "gross" DECIMAL(12,2) NOT NULL,
    "deductions" DECIMAL(12,2) NOT NULL,
    "statutory" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "daysPaid" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lopDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "componentBreakdown" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSummary" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "presentDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lopDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "otHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPayRule_companyId_key" ON "CompanyPayRule"("companyId");

-- CreateIndex
CREATE INDEX "SalaryStructure_employeeId_effectiveFrom_idx" ON "SalaryStructure"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "SalaryComponent_structureId_idx" ON "SalaryComponent"("structureId");

-- CreateIndex
CREATE INDEX "EmployeeSalaryRevision_employeeId_effectiveFrom_idx" ON "EmployeeSalaryRevision"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "StatutoryProfile_employeeId_key" ON "StatutoryProfile"("employeeId");

-- CreateIndex
CREATE INDEX "PayrollRun_companyId_status_idx" ON "PayrollRun"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_companyId_month_year_key" ON "PayrollRun"("companyId", "month", "year");

-- CreateIndex
CREATE INDEX "PayrollLine_runId_idx" ON "PayrollLine"("runId");

-- CreateIndex
CREATE INDEX "PayrollLine_employeeId_idx" ON "PayrollLine"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLine_runId_employeeId_key" ON "PayrollLine"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "AttendanceSummary_companyId_month_year_idx" ON "AttendanceSummary"("companyId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSummary_employeeId_companyId_month_year_key" ON "AttendanceSummary"("employeeId", "companyId", "month", "year");

-- AddForeignKey
ALTER TABLE "CompanyPayRule" ADD CONSTRAINT "CompanyPayRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryComponent" ADD CONSTRAINT "SalaryComponent_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "SalaryStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSalaryRevision" ADD CONSTRAINT "EmployeeSalaryRevision_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSalaryRevision" ADD CONSTRAINT "EmployeeSalaryRevision_revisedById_fkey" FOREIGN KEY ("revisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatutoryProfile" ADD CONSTRAINT "StatutoryProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_runById_fkey" FOREIGN KEY ("runById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSummary" ADD CONSTRAINT "AttendanceSummary_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSummary" ADD CONSTRAINT "AttendanceSummary_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

