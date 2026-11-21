import { describe, it, expect } from 'vitest'
import { differenceInCalendarDays, getDaysInMonth } from 'date-fns'
import { getPayrollCycle, getCompanyPayrollCycle } from '@/lib/payroll/cycle'

describe('OD-P1: Dynamic Payroll Calendar Engine', () => {
  describe('1. 1st-to-Month-End Cycle (Auto Leap-Year Handling)', () => {
    it('Feb 2028 (leap year) dynamically produces 29 days (2028-02-01 to 2028-02-29)', () => {
      const cycle = getPayrollCycle(2028, 2, { cycleType: '1ST_TO_MONTH_END' })

      expect(cycle.startDateISO).toBe('2028-02-01')
      expect(cycle.endDateISO).toBe('2028-02-29')
      expect(cycle.totalDays).toBe(29)
      expect(cycle.isLeapYear).toBe(true)
      expect(cycle.daysInMonth).toBe(29)
      expect(cycle.dates).toHaveLength(29)
      expect(cycle.dates[0]).toBe('2028-02-01')
      expect(cycle.dates[28]).toBe('2028-02-29')
    })

    it('Feb 2027 (non-leap year) dynamically produces 28 days (2027-02-01 to 2027-02-28)', () => {
      const cycle = getPayrollCycle(2027, 2, { cycleType: '1ST_TO_MONTH_END' })

      expect(cycle.startDateISO).toBe('2027-02-01')
      expect(cycle.endDateISO).toBe('2027-02-28')
      expect(cycle.totalDays).toBe(28)
      expect(cycle.isLeapYear).toBe(false)
      expect(cycle.daysInMonth).toBe(28)
      expect(cycle.dates).toHaveLength(28)
    })

    it('Jan 2028 dynamically produces 31 days (2028-01-01 to 2028-01-31)', () => {
      const cycle = getPayrollCycle(2028, 1, { cycleType: '1ST_TO_MONTH_END' })

      expect(cycle.startDateISO).toBe('2028-01-01')
      expect(cycle.endDateISO).toBe('2028-01-31')
      expect(cycle.totalDays).toBe(31)
      expect(cycle.dates).toHaveLength(31)
    })

    it('Apr 2028 dynamically produces 30 days (2028-04-01 to 2028-04-30)', () => {
      const cycle = getPayrollCycle(2028, 4, { cycleType: '1ST_TO_MONTH_END' })

      expect(cycle.startDateISO).toBe('2028-04-01')
      expect(cycle.endDateISO).toBe('2028-04-30')
      expect(cycle.totalDays).toBe(30)
      expect(cycle.dates).toHaveLength(30)
    })
  })

  describe('2. 26th-to-25th Cycle (Across Month Boundary)', () => {
    it('March 2028 cycle spans 2028-02-26 to 2028-03-25 with 29 days (Feb leap year auto handled)', () => {
      const cycle = getPayrollCycle(2028, 3, { cycleType: '26TH_TO_25TH' })

      // Starts 26th Feb 2028, ends 25th Mar 2028
      expect(cycle.startDateISO).toBe('2028-02-26')
      expect(cycle.endDateISO).toBe('2028-03-25')

      // Feb 2028 has 29 days -> 26, 27, 28, 29 (4 days) + Mar 1-25 (25 days) = 29 days total
      expect(cycle.totalDays).toBe(29)
      expect(cycle.dates).toHaveLength(29)
      expect(cycle.dates[0]).toBe('2028-02-26')
      expect(cycle.dates[3]).toBe('2028-02-29')
      expect(cycle.dates[4]).toBe('2028-03-01')
      expect(cycle.dates[28]).toBe('2028-03-25')
    })

    it('March 2027 cycle spans 2027-02-26 to 2027-03-25 with 28 days (Feb non-leap auto handled)', () => {
      const cycle = getPayrollCycle(2027, 3, { cycleType: '26TH_TO_25TH' })

      expect(cycle.startDateISO).toBe('2027-02-26')
      expect(cycle.endDateISO).toBe('2027-03-25')

      // Feb 2027 has 28 days -> 26, 27, 28 (3 days) + Mar 1-25 (25 days) = 28 days total
      expect(cycle.totalDays).toBe(28)
      expect(cycle.dates).toHaveLength(28)
      expect(cycle.dates[0]).toBe('2027-02-26')
      expect(cycle.dates[2]).toBe('2027-02-28')
      expect(cycle.dates[3]).toBe('2027-03-01')
      expect(cycle.dates[27]).toBe('2027-03-25')
    })

    it('January 2028 cycle spans year boundary: 2027-12-26 to 2028-01-25 (31 days)', () => {
      const cycle = getPayrollCycle(2028, 1, { cycleType: '26TH_TO_25TH' })

      expect(cycle.startDateISO).toBe('2027-12-26')
      expect(cycle.endDateISO).toBe('2028-01-25')

      // Dec has 31 days -> 26, 27, 28, 29, 30, 31 (6 days) + Jan 1-25 (25 days) = 31 days
      expect(cycle.totalDays).toBe(31)
      expect(cycle.dates).toHaveLength(31)
      expect(cycle.dates[0]).toBe('2027-12-26')
      expect(cycle.dates[5]).toBe('2027-12-31')
      expect(cycle.dates[6]).toBe('2028-01-01')
      expect(cycle.dates[30]).toBe('2028-01-25')
    })

    it('May 2028 cycle spans April: 2028-04-26 to 2028-05-25 (30 days)', () => {
      const cycle = getPayrollCycle(2028, 5, { cycleType: '26TH_TO_25TH' })

      expect(cycle.startDateISO).toBe('2028-04-26')
      expect(cycle.endDateISO).toBe('2028-05-25')

      // Apr has 30 days -> 26, 27, 28, 29, 30 (5 days) + May 1-25 (25 days) = 30 days
      expect(cycle.totalDays).toBe(30)
      expect(cycle.dates).toHaveLength(30)
    })
  })

  describe('3. Dynamic Calendar Proof (Zero Hardcoding)', () => {
    it('All 12 months in 2028 and 2029 match dynamic date library calculations exactly', () => {
      for (const year of [2028, 2029]) {
        for (let m = 1; m <= 12; m++) {
          const cycle = getPayrollCycle(year, m, { cycleType: '1ST_TO_MONTH_END' })
          const expectedDays = getDaysInMonth(new Date(Date.UTC(year, m - 1, 1)))

          expect(cycle.totalDays).toBe(expectedDays)
          expect(cycle.dates).toHaveLength(expectedDays)
          expect(cycle.totalDays).toBe(
            differenceInCalendarDays(cycle.endDate, cycle.startDate) + 1
          )
        }
      }
    })

    it('Custom cutoff day (e.g. 20th of month) works dynamically', () => {
      const cycle = getPayrollCycle(2028, 4, { cycleType: 'CUSTOM_CUTOFF', cutoffDay: 20 })

      // March has 31 days -> 21 to 31 = 11 days; April 1 to 20 = 20 days -> 31 days
      expect(cycle.startDateISO).toBe('2028-03-21')
      expect(cycle.endDateISO).toBe('2028-04-20')
      expect(cycle.totalDays).toBe(31)
      expect(cycle.dates).toHaveLength(31)
    })

    it('Invalid month throws informative error', () => {
      expect(() => getPayrollCycle(2028, 13)).toThrow(/Invalid month: 13/)
      expect(() => getPayrollCycle(2028, 0)).toThrow(/Invalid month: 0/)
    })
  })

  describe('4. Company Configuration Integration', () => {
    it('Company with payrollCutoffDay: 25 automatically uses 26th-to-25th cycle', () => {
      const cycle = getCompanyPayrollCycle({ payrollCutoffDay: 25 }, 2028, 3)

      expect(cycle.cycleType).toBe('26TH_TO_25TH')
      expect(cycle.startDateISO).toBe('2028-02-26')
      expect(cycle.endDateISO).toBe('2028-03-25')
    })

    it('Company with payrollCutoffDay: null falls back to default cutoff 25 (26th-to-25th); 0 uses 1st-to-Month-End', () => {
      // 1. null falls back to default cutoff 25 -> '26TH_TO_25TH'
      const cycleNull = getCompanyPayrollCycle({ payrollCutoffDay: null }, 2028, 3)
      expect(cycleNull.cycleType).toBe('26TH_TO_25TH')
      expect(cycleNull.startDateISO).toBe('2028-02-26')
      expect(cycleNull.endDateISO).toBe('2028-03-25')
      expect(cycleNull.totalDays).toBe(29) // Feb 2028 is leap year (4 days) + Mar (25 days)

      // 2. 0 disables cutoff cycle -> '1ST_TO_MONTH_END'
      const cycleZero = getCompanyPayrollCycle({ payrollCutoffDay: 0 }, 2028, 3)
      expect(cycleZero.cycleType).toBe('1ST_TO_MONTH_END')
      expect(cycleZero.startDateISO).toBe('2028-03-01')
      expect(cycleZero.endDateISO).toBe('2028-03-31')
      expect(cycleZero.totalDays).toBe(31)
    })
  })
})

