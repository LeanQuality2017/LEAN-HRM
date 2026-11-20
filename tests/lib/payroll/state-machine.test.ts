import { describe, it, expect } from 'vitest'
import { validateAdjacentStatusTransition } from '@/app/api/payroll/route'
import { PAYROLL_STATUS } from '@/lib/constants'

describe('Payroll State Machine Transitions', () => {
  describe('Valid Adjacent Forward Transitions', () => {
    it('allows DRAFT -> LOCKED', () => {
      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.DRAFT, PAYROLL_STATUS.LOCKED)
      ).not.toThrow()
    })

    it('allows LOCKED -> PROCESSED', () => {
      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.LOCKED, PAYROLL_STATUS.PROCESSED)
      ).not.toThrow()
    })

    it('allows PROCESSED -> PAID', () => {
      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.PROCESSED, PAYROLL_STATUS.PAID)
      ).not.toThrow()
    })

    it('allows same-state idempotency', () => {
      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.DRAFT, PAYROLL_STATUS.DRAFT)
      ).not.toThrow()
      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.LOCKED, PAYROLL_STATUS.LOCKED)
      ).not.toThrow()
      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.PROCESSED, PAYROLL_STATUS.PROCESSED)
      ).not.toThrow()
    })
  })

  describe('Invalid Skipped & Reverse Transitions', () => {
    it('blocks DRAFT -> PROCESSED (must lock first)', () => {
      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.DRAFT, PAYROLL_STATUS.PROCESSED)
      ).toThrow('Invalid transition: DRAFT can only move to LOCKED')
    })

    it('blocks DRAFT -> PAID (cannot skip locked and processed)', () => {
      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.DRAFT, PAYROLL_STATUS.PAID)
      ).toThrow('Invalid transition: DRAFT can only move to LOCKED')
    })

    it('blocks LOCKED -> PAID (cannot skip processed)', () => {
      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.LOCKED, PAYROLL_STATUS.PAID)
      ).toThrow('Invalid transition: LOCKED can only move to PROCESSED')
    })

    it('blocks reverse transition LOCKED -> DRAFT', () => {
      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.LOCKED, PAYROLL_STATUS.DRAFT)
      ).toThrow('Invalid transition')
    })

    it('blocks reverse transition PROCESSED -> LOCKED', () => {
      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.PROCESSED, PAYROLL_STATUS.LOCKED)
      ).toThrow('Invalid transition')
    })
  })

  describe('PAID Immutability Guard', () => {
    it('blocks any status change once PAID', () => {
      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.PAID, PAYROLL_STATUS.DRAFT)
      ).toThrow('Paid payroll records are fully immutable')

      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.PAID, PAYROLL_STATUS.PROCESSED)
      ).toThrow('Paid payroll records are fully immutable')

      expect(() =>
        validateAdjacentStatusTransition(PAYROLL_STATUS.PAID, PAYROLL_STATUS.PAID)
      ).toThrow('Paid payroll records are fully immutable')
    })
  })
})

