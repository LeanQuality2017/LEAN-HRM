import { describe, it, expect, vi } from 'vitest'
import { resolveShiftForDate, ShiftResolutionError } from '@/lib/attendance/resolveShift'

describe('Attendance Shift Resolution (resolveShiftForDate)', () => {
  const dummyAssignmentShift = {
    id: 'shift_assigned',
    companyId: 'company_alpha',
    name: 'Assigned Morning Shift',
    startTime: '09:00',
    endTime: '17:00',
    breakMinutes: 60,
    graceMinutes: 15,
    isDefault: false,
  }

  const dummyDefaultShift = {
    id: 'shift_default',
    companyId: 'company_alpha',
    name: 'Default Company Shift',
    startTime: '09:30',
    endTime: '18:30',
    breakMinutes: 60,
    graceMinutes: 15,
    isDefault: true,
  }

  it('assignment wins: returns shift from active assignment covering the date', async () => {
    const mockClient = {
      employeeShiftAssignment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'assign_1',
          employeeId: 'emp_1',
          shiftId: 'shift_assigned',
          effectiveFrom: new Date('2026-01-01'),
          effectiveTo: null,
          shift: dummyAssignmentShift,
        }),
      },
      shift: {
        findFirst: vi.fn().mockResolvedValue(dummyDefaultShift),
      },
    }

    const res = await resolveShiftForDate('emp_1', 'company_alpha', new Date('2026-06-10'), mockClient)
    expect(res.source).toBe('ASSIGNMENT')
    expect(res.shift.id).toBe('shift_assigned')
    expect(res.shift.name).toBe('Assigned Morning Shift')
    expect(mockClient.shift.findFirst).not.toHaveBeenCalled()
  })

  it('default fallback: returns company default shift when no assignment covers the date', async () => {
    const mockClient = {
      employeeShiftAssignment: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      shift: {
        findFirst: vi.fn().mockResolvedValue(dummyDefaultShift),
      },
    }

    const res = await resolveShiftForDate('emp_1', 'company_alpha', new Date('2026-06-10'), mockClient)
    expect(res.source).toBe('DEFAULT')
    expect(res.shift.id).toBe('shift_default')
    expect(res.shift.name).toBe('Default Company Shift')
    expect(mockClient.shift.findFirst).toHaveBeenCalledWith({
      where: {
        companyId: 'company_alpha',
        isDefault: true,
      },
    })
  })

  it('none -> throws ShiftResolutionError when neither assignment nor default shift exists', async () => {
    const mockClient = {
      employeeShiftAssignment: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      shift: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    }

    await expect(
      resolveShiftForDate('emp_1', 'company_alpha', new Date('2026-06-10'), mockClient)
    ).rejects.toThrow(ShiftResolutionError)
  })
})

