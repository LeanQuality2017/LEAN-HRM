import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  mapPayslipData,
  generatePayslipPdf,
  generatePayslipDocx,
  PayslipRenderData,
} from '@/lib/payroll/payslip-doc'

describe('Payslip PDF & Document Mapping (Pure Functions)', () => {
  describe('1. mapPayslipData - Legacy Record Mapping', () => {
    it('maps standard legacy Payroll record correctly', () => {
      const mockRecord = {
        id: 'pay-legacy-1',
        employeeId: 'emp-101',
        month: 6,
        year: 2026,
        basic: new Prisma.Decimal('30000.00'),
        allowances: new Prisma.Decimal('20000.00'),
        deductions: new Prisma.Decimal('5000.00'),
        netPay: new Prisma.Decimal('45000.00'),
        status: 'PAID',
        paidAt: new Date('2026-06-30T10:00:00Z'),
        createdAt: new Date('2026-06-25T10:00:00Z'),
        employee: {
          id: 'emp-101',
          employeeCode: 'ALPHA-001',
          user: { name: 'Alice Smith', email: 'alice@alpha.test' },
          assignments: [
            {
              isPrimary: true,
              designation: 'Senior Developer',
              company: {
                name: 'Alpha Technologies Ltd',
                code: 'ALPHA',
                address: '123 Tech Park, Chennai',
                phone: '+91 44 12345678',
                email: 'hr@alphatech.test',
              },
            },
          ],
        },
      }

      const result = mapPayslipData(mockRecord)

      // Company header
      expect(result.company.name).toBe('Alpha Technologies Ltd')
      expect(result.company.code).toBe('ALPHA')
      expect(result.company.address).toBe('123 Tech Park, Chennai')
      expect(result.company.phone).toBe('+91 44 12345678')
      expect(result.company.email).toBe('hr@alphatech.test')

      // Employee + code
      expect(result.employee.name).toBe('Alice Smith')
      expect(result.employee.code).toBe('ALPHA-001')
      expect(result.employee.designation).toBe('Senior Developer')

      // Month / year
      expect(result.period.month).toBe(6)
      expect(result.period.monthName).toBe('June')
      expect(result.period.year).toBe(2026)
      expect(result.period.periodLabel).toBe('June 2026')

      // Financials
      expect(result.gross).toBe(50000)
      expect(result.totalDeductions).toBe(5000)
      expect(result.netPay).toBe(45000)

      // Items list
      expect(result.items.length).toBe(3)
      expect(result.items[0]).toEqual({
        name: 'Basic Salary',
        amount: 30000,
        type: 'EARNING',
        category: 'BASIC',
      })

      // Attendance defaults
      expect(result.attendance.daysPaid).toBe(30)
      expect(result.attendance.lopDays).toBe(0)

      // System generated note
      expect(result.systemGeneratedNote).toBe(
        'This is a computer-generated payslip and requires no physical signature.'
      )
    })
  })

  describe('2. mapPayslipData - Component Breakdown Snapshot Mapping', () => {
    it('maps detailed PayrollLine breakdown JSON with statutory deductions', () => {
      const breakdown = {
        earnings: [
          { name: 'BASIC', amount: new Prisma.Decimal('25000.00') },
          { name: 'HRA', amount: new Prisma.Decimal('15000.00') },
          { name: 'SPECIAL_ALLOWANCE', amount: new Prisma.Decimal('10000.00') },
          { name: 'OVERTIME', amount: new Prisma.Decimal('2500.00') },
        ],
        deductions: [
          { name: 'MESS_ADVANCE', amount: new Prisma.Decimal('1000.00') },
        ],
        statutory: {
          pf: { employee: new Prisma.Decimal('1800.00') },
          esi: { employee: new Prisma.Decimal('0.00') },
          professionalTax: new Prisma.Decimal('208.33'),
          tds: new Prisma.Decimal('0.00'),
        },
        attendance: {
          totalMonthDays: new Prisma.Decimal('30.00'),
          paidDays: new Prisma.Decimal('27.00'),
          lopDays: new Prisma.Decimal('3.00'),
          otHours: new Prisma.Decimal('10.00'),
        },
      }

      const mockLineRecord = {
        id: 'line-v2-101',
        employeeId: 'emp-202',
        month: 6,
        year: 2026,
        gross: new Prisma.Decimal('52500.00'),
        deductions: new Prisma.Decimal('3008.33'),
        statutory: new Prisma.Decimal('2008.33'),
        net: new Prisma.Decimal('49491.67'),
        daysPaid: new Prisma.Decimal('27.00'),
        lopDays: new Prisma.Decimal('3.00'),
        componentBreakdown: JSON.stringify(breakdown),
        status: 'PROCESSED',
        employee: {
          id: 'emp-202',
          employeeCode: 'BETA-042',
          user: { name: 'Bob Johnson', email: 'bob@beta.test' },
          assignments: [
            {
              isPrimary: true,
              designation: 'Tech Lead',
              company: { name: 'Beta Solutions Inc' },
            },
          ],
        },
      }

      const result = mapPayslipData(mockLineRecord)

      // Breakdown parsing
      expect(result.attendance.daysPaid).toBe(27)
      expect(result.attendance.lopDays).toBe(3)

      expect(result.gross).toBe(52500)
      expect(result.statutoryDeductions).toBe(2008.33)
      expect(result.totalDeductions).toBe(3008.33)
      expect(result.netPay).toBe(49491.67)

      // Itemized list includes all breakdown components
      const names = result.items.map((i) => i.name)
      expect(names).toContain('BASIC')
      expect(names).toContain('HRA')
      expect(names).toContain('SPECIAL_ALLOWANCE')
      expect(names).toContain('OVERTIME')
      expect(names).toContain('Provident Fund (EPF)')
      expect(names).toContain('Professional Tax (PT)')
      expect(names).toContain('MESS_ADVANCE')
    })

    it('throws error on null or missing record', () => {
      expect(() => mapPayslipData(null)).toThrow('Record is required')
      expect(() => mapPayslipData(undefined)).toThrow('Record is required')
    })
  })

  describe('3. generatePayslipPdf Server-Side Rendering', () => {
    it('generates a strictly compliant Adobe PDF 1.4 binary buffer', () => {
      const renderData: PayslipRenderData = {
        id: 'test-payslip-pdf-01',
        company: {
          name: 'Alpha Technologies Ltd',
          code: 'ALPHA',
          address: '42 Cyber City, Chennai',
          phone: '+91 44 98765432',
          email: 'payroll@alpha.test',
        },
        employee: {
          id: 'emp-99',
          name: 'Jane Doe',
          code: 'ALPHA-099',
          designation: 'Staff Software Engineer',
          email: 'jane@alpha.test',
        },
        period: {
          month: 6,
          monthName: 'June',
          year: 2026,
          periodLabel: 'June 2026',
        },
        attendance: {
          daysPaid: 30,
          lopDays: 0,
        },
        items: [
          { name: 'BASIC', amount: 35000, type: 'EARNING', category: 'BASIC' },
          { name: 'HRA', amount: 21000, type: 'EARNING', category: 'ALLOWANCE' },
          { name: 'SPECIAL_ALLOWANCE', amount: 14000, type: 'EARNING', category: 'ALLOWANCE' },
          { name: 'Provident Fund (EPF)', amount: 1800, type: 'DEDUCTION', category: 'STATUTORY' },
          { name: 'Professional Tax (PT)', amount: 208.33, type: 'DEDUCTION', category: 'STATUTORY' },
        ],
        gross: 70000,
        statutoryDeductions: 2008.33,
        totalDeductions: 2008.33,
        netPay: 67991.67,
        status: 'PAID',
        systemGeneratedNote: 'This is a computer-generated payslip and requires no physical signature.',
      }

      const pdf = generatePayslipPdf(renderData)

      // Buffer assertions
      expect(Buffer.isBuffer(pdf)).toBe(true)
      expect(pdf.length).toBeGreaterThan(500)

      const pdfString = pdf.toString('utf-8')

      // Must start with %PDF-1.4
      expect(pdfString.startsWith('%PDF-1.4')).toBe(true)

      // Must terminate with %%EOF
      expect(pdfString.endsWith('%%EOF')).toBe(true)

      // Must contain xref table and catalog
      expect(pdfString).toContain('xref')
      expect(pdfString).toContain('/Type /Catalog')
      expect(pdfString).toContain('/Type /Page')

      // Must contain embedded company and employee content
      expect(pdfString).toContain('Alpha Technologies Ltd')
      expect(pdfString).toContain('Jane Doe')
      expect(pdfString).toContain('ALPHA-099')
      expect(pdfString).toContain('June 2026')
      expect(pdfString).toContain('67991.67')
      expect(pdfString).toContain('This is a computer-generated payslip and requires no physical signature.')
    })
  })

  describe('4. generatePayslipDocx Word Document Generation', () => {
    it('generates a valid Word docx buffer using the docx library', async () => {
      const renderData: PayslipRenderData = {
        id: 'test-payslip-docx-01',
        company: { name: 'Beta Solutions' },
        employee: {
          id: 'emp-10',
          name: 'Charlie Brown',
          code: 'BETA-010',
          designation: 'Architect',
        },
        period: {
          month: 7,
          monthName: 'July',
          year: 2026,
          periodLabel: 'July 2026',
        },
        attendance: { daysPaid: 31, lopDays: 0 },
        items: [
          { name: 'Basic', amount: 50000, type: 'EARNING' },
          { name: 'Deductions', amount: 3000, type: 'DEDUCTION' },
        ],
        gross: 50000,
        statutoryDeductions: 3000,
        totalDeductions: 3000,
        netPay: 47000,
        status: 'PAID',
        systemGeneratedNote: 'This is a computer-generated payslip and requires no physical signature.',
      }

      const docxBuffer = await generatePayslipDocx(renderData)

      expect(Buffer.isBuffer(docxBuffer)).toBe(true)
      expect(docxBuffer.length).toBeGreaterThan(1000)

      // Standard PK zip header for docx openxml packages (0x50, 0x4B, 0x03, 0x04)
      expect(docxBuffer[0]).toBe(0x50)
      expect(docxBuffer[1]).toBe(0x4b)
      expect(docxBuffer[2]).toBe(0x03)
      expect(docxBuffer[3]).toBe(0x04)
    })
  })
})

