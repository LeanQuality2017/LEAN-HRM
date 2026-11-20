-- AlterTable
ALTER TABLE "CompanyPayRule" ADD COLUMN "regularisationWindowDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 60,
    "graceMinutes" INTEGER NOT NULL DEFAULT 15,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "weekoffMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 2.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeShiftAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "EmployeeShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRegularisation" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "requestedStatus" TEXT NOT NULL,
    "requestedCheckIn" TIMESTAMP(3),
    "requestedCheckOut" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceRegularisation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shift_companyId_name_key" ON "Shift"("companyId", "name");

-- CreateIndex
CREATE INDEX "Shift_companyId_idx" ON "Shift"("companyId");

-- CreateIndex
CREATE INDEX "EmployeeShiftAssignment_employeeId_effectiveFrom_idx" ON "EmployeeShiftAssignment"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "EmployeeShiftAssignment_shiftId_idx" ON "EmployeeShiftAssignment"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_companyId_date_key" ON "Holiday"("companyId", "date");

-- CreateIndex
CREATE INDEX "Holiday_companyId_date_idx" ON "Holiday"("companyId", "date");

-- CreateIndex
CREATE INDEX "AttendanceRegularisation_employeeId_status_idx" ON "AttendanceRegularisation"("employeeId", "status");

-- CreateIndex
CREATE INDEX "AttendanceRegularisation_companyId_status_idx" ON "AttendanceRegularisation"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_companyId_date_key" ON "Attendance"("employeeId", "companyId", "date");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeShiftAssignment" ADD CONSTRAINT "EmployeeShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeShiftAssignment" ADD CONSTRAINT "EmployeeShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRegularisation" ADD CONSTRAINT "AttendanceRegularisation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRegularisation" ADD CONSTRAINT "AttendanceRegularisation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRegularisation" ADD CONSTRAINT "AttendanceRegularisation_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

