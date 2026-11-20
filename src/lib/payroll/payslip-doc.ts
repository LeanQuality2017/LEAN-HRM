import { db } from '@/lib/db'
import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Packer,
  WidthType,
  AlignmentType,
  BorderStyle,
} from 'docx'
import { PdfDocument } from './pdf-builder'

export interface PayslipItem {
  name: string
  amount: number
  type: 'EARNING' | 'DEDUCTION'
  category?: 'BASIC' | 'ALLOWANCE' | 'STATUTORY' | 'OTHER'
}

export interface PayslipRenderData {
  id: string
  company: {
    name: string
    code?: string | null
    address?: string | null
    phone?: string | null
    email?: string | null
  }
  employee: {
    id: string
    name: string
    code: string
    designation: string
    email?: string | null
  }
  period: {
    month: number
    monthName: string
    year: number
    periodLabel: string
  }
  attendance: {
    daysPaid: number
    lopDays: number
  }
  items: PayslipItem[]
  gross: number
  statutoryDeductions: number
  totalDeductions: number
  netPay: number
  status: string
  generatedAt?: string | null
  paidAt?: string | null
  systemGeneratedNote: string
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * Pure data-mapping function:
 * Converts raw database records (Payroll or PayrollLine) into a normalized PayslipRenderData contract.
 * Pure, side-effect free, testable without DB access.
 */
export function mapPayslipData(record: any): PayslipRenderData {
  if (!record) {
    throw new Error('Record is required for payslip mapping')
  }

  // 1. Company details
  const primaryAssignment =
    record.employee?.assignments?.find((a: any) => a.isPrimary) ||
    record.employee?.assignments?.[0]
  const companyObj = primaryAssignment?.company || {}

  const company = {
    name: companyObj.name || 'UniHR Corporation',
    code: companyObj.code || null,
    address: companyObj.address || null,
    phone: companyObj.phone || null,
    email: companyObj.email || null,
  }

  // 2. Employee details
  const employee = {
    id: record.employee?.id || record.employeeId || 'unknown',
    name: record.employee?.user?.name || 'Staff Member',
    code: record.employee?.employeeCode || 'EMP-000',
    designation: primaryAssignment?.designation || 'Staff',
    email: record.employee?.user?.email || null,
  }

  // 3. Period details
  let month = Number(record.month || record.run?.month || 0)
  let year = Number(record.year || record.run?.year || 0)

  if ((!month || !year) && record.componentBreakdown) {
    try {
      const parsed =
        typeof record.componentBreakdown === 'string'
          ? JSON.parse(record.componentBreakdown)
          : record.componentBreakdown
      if (parsed.month) month = Number(parsed.month)
      if (parsed.year) year = Number(parsed.year)
    } catch {
      // Ignore JSON parse error
    }
  }

  if (!month) month = 1
  if (!year) year = new Date().getFullYear()
  const monthName = MONTH_NAMES[month - 1] || 'January'

  // 4. Breakdown components & attendance metrics
  const items: PayslipItem[] = []
  let daysPaid = 30
  let lopDays = 0
  let gross = 0
  let statutoryDeductions = 0
  let totalDeductions = 0
  let netPay = 0

  if (record.componentBreakdown) {
    try {
      const parsed =
        typeof record.componentBreakdown === 'string'
          ? JSON.parse(record.componentBreakdown)
          : record.componentBreakdown

      if (parsed.attendance) {
        daysPaid = Number(parsed.attendance.paidDays ?? 30)
        lopDays = Number(parsed.attendance.lopDays ?? 0)
      }

      if (parsed.earnings && Array.isArray(parsed.earnings)) {
        for (const e of parsed.earnings) {
          const amt = Number(e.amount ?? 0)
          items.push({
            name: e.name,
            amount: amt,
            type: 'EARNING',
            category: e.name === 'BASIC' ? 'BASIC' : 'ALLOWANCE',
          })
          gross += amt
        }
      }

      if (parsed.statutory) {
        const s = parsed.statutory
        if (s.pf && Number(s.pf.employee ?? 0) > 0) {
          const amt = Number(s.pf.employee)
          items.push({
            name: 'Provident Fund (EPF)',
            amount: amt,
            type: 'DEDUCTION',
            category: 'STATUTORY',
          })
          statutoryDeductions += amt
        }
        if (s.esi && Number(s.esi.employee ?? 0) > 0) {
          const amt = Number(s.esi.employee)
          items.push({
            name: 'Employee State Insurance (ESI)',
            amount: amt,
            type: 'DEDUCTION',
            category: 'STATUTORY',
          })
          statutoryDeductions += amt
        }
        if (s.professionalTax && Number(s.professionalTax ?? 0) > 0) {
          const amt = Number(s.professionalTax)
          items.push({
            name: 'Professional Tax (PT)',
            amount: amt,
            type: 'DEDUCTION',
            category: 'STATUTORY',
          })
          statutoryDeductions += amt
        }
        if (s.tds && Number(s.tds ?? 0) > 0) {
          const amt = Number(s.tds)
          items.push({
            name: 'Income Tax (TDS)',
            amount: amt,
            type: 'DEDUCTION',
            category: 'STATUTORY',
          })
          statutoryDeductions += amt
        } else if (record.tds && Number(record.tds) > 0) {
          const amt = Number(record.tds)
          items.push({
            name: 'Income Tax (TDS)',
            amount: amt,
            type: 'DEDUCTION',
            category: 'STATUTORY',
          })
          statutoryDeductions += amt
        }
      }

      if (parsed.deductions && Array.isArray(parsed.deductions)) {
        for (const d of parsed.deductions) {
          const amt = Number(d.amount ?? 0)
          items.push({
            name: d.name,
            amount: amt,
            type: 'DEDUCTION',
            category: 'OTHER',
          })
          totalDeductions += amt
        }
      }

      totalDeductions += statutoryDeductions
      netPay = Number(record.net ?? record.netPay ?? gross - totalDeductions)
    } catch {
      // Fallback below
    }
  }

  // Fallback to legacy fields if items empty
  if (items.length === 0) {
    const basic = Number(record.basic ?? 0)
    const allowances = Number(record.allowances ?? 0)
    const deductions = Number(record.deductions ?? 0)
    gross = Number(record.gross ?? basic + allowances)
    totalDeductions = deductions
    statutoryDeductions = 0
    netPay = Number(record.netPay ?? gross - totalDeductions)

    items.push({ name: 'Basic Salary', amount: basic, type: 'EARNING', category: 'BASIC' })
    items.push({ name: 'Allowances', amount: allowances, type: 'EARNING', category: 'ALLOWANCE' })
    items.push({ name: 'Deductions', amount: deductions, type: 'DEDUCTION', category: 'OTHER' })

    daysPaid = Number(record.daysPaid ?? 30)
    lopDays = Number(record.lopDays ?? 0)
  }

  return {
    id: record.id || 'N/A',
    company,
    employee,
    period: {
      month,
      monthName,
      year,
      periodLabel: `${monthName} ${year}`,
    },
    attendance: {
      daysPaid: Math.round(daysPaid * 100) / 100,
      lopDays: Math.round(lopDays * 100) / 100,
    },
    items,
    gross: Math.round(gross * 100) / 100,
    statutoryDeductions: Math.round(statutoryDeductions * 100) / 100,
    totalDeductions: Math.round(totalDeductions * 100) / 100,
    netPay: Math.round(netPay * 100) / 100,
    status: record.status || record.run?.status || 'DRAFT',
    generatedAt: record.createdAt ? new Date(record.createdAt).toISOString() : null,
    paidAt: record.paidAt ? new Date(record.paidAt).toISOString() : null,
    systemGeneratedNote: 'This is a computer-generated payslip and requires no physical signature.',
  }
}

/**
 * Reusable server-side data loader for a payslip record.
 * Reuses the existing payslip page data path to avoid duplicate queries.
 */
export async function loadPayslipRecord(id: string) {
  // Query primary payroll record with relations
  const payslip = await db.payroll.findUnique({
    where: { id },
    include: {
      employee: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          assignments: {
            include: { company: true },
          },
        },
      },
      generatedBy: { select: { name: true, email: true } },
    },
  })

  if (payslip) {
    return payslip
  }

  // If not found in legacy table, query PayrollLine v2
  const line = await db.payrollLine.findUnique({
    where: { id },
    include: {
      run: true,
      employee: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          assignments: {
            include: { company: true },
          },
        },
      },
    },
  })

  if (line) {
    return {
      id: line.id,
      employeeId: line.employeeId,
      month: line.run.month,
      year: line.run.year,
      basic: line.gross,
      allowances: 0,
      deductions: line.deductions,
      netPay: line.net,
      gross: line.gross,
      status: line.run.status,
      paidAt: line.run.paidAt,
      createdAt: line.createdAt,
      componentBreakdown: line.componentBreakdown,
      daysPaid: line.daysPaid,
      lopDays: line.lopDays,
      tds: line.tds,
      employee: line.employee,
      generatedBy: null,
    }
  }

  return null
}

/**
 * Generates a server-side PDF payslip buffer using pure PdfDocument.
 */
export function generatePayslipPdf(data: PayslipRenderData): Buffer {
  const doc = new PdfDocument()

  // 1. Top Header Accent
  doc.setFillColor(0.05, 0.45, 0.45).drawRect(40, 790, 515.28, 4)

  // 2. Company Information (Left)
  doc.drawText(data.company.name, 40, 765, {
    font: 'Helvetica-Bold',
    size: 16,
    color: [0.1, 0.1, 0.1],
  })

  let contactY = 748
  if (data.company.code) {
    doc.drawText(`Company Code: ${data.company.code}`, 40, contactY, {
      font: 'Helvetica',
      size: 8,
      color: [0.4, 0.4, 0.4],
    })
    contactY -= 12
  }
  if (data.company.address) {
    doc.drawText(data.company.address, 40, contactY, {
      font: 'Helvetica',
      size: 8,
      color: [0.4, 0.4, 0.4],
    })
    contactY -= 12
  }
  if (data.company.email || data.company.phone) {
    const contactStr = [
      data.company.phone ? `Phone: ${data.company.phone}` : null,
      data.company.email ? `Email: ${data.company.email}` : null,
    ]
      .filter(Boolean)
      .join(' | ')
    doc.drawText(contactStr, 40, contactY, {
      font: 'Helvetica',
      size: 8,
      color: [0.4, 0.4, 0.4],
    })
  }

  // 3. Payslip Title & Period Badge (Right)
  doc.setFillColor(0.94, 0.96, 0.98).drawRect(420, 735, 135.28, 45, true, false)
  doc.drawText('PAYSLIP', 430, 762, {
    font: 'Helvetica-Bold',
    size: 11,
    color: [0.1, 0.35, 0.35],
  })
  doc.drawText(data.period.periodLabel, 430, 747, {
    font: 'Helvetica-Bold',
    size: 10,
    color: [0.2, 0.2, 0.2],
  })
  doc.drawText(`Status: ${data.status}`, 430, 735, {
    font: 'Helvetica',
    size: 8,
    color: data.status === 'PAID' ? [0.1, 0.6, 0.2] : [0.5, 0.5, 0.5],
  })

  // 4. Employee Information Box
  const empBoxY = 660
  doc.setFillColor(0.96, 0.97, 0.98).drawRect(40, empBoxY, 515.28, 55, true, false)
  doc.setStrokeColor(0.85, 0.88, 0.9).setLineWidth(0.5).drawRect(40, empBoxY, 515.28, 55, false, true)

  // Column 1
  doc.drawText('Employee Name:', 50, empBoxY + 38, { font: 'Helvetica', size: 8, color: [0.4, 0.4, 0.4] })
  doc.drawText(data.employee.name, 50, empBoxY + 25, { font: 'Helvetica-Bold', size: 10 })
  doc.drawText('Designation:', 50, empBoxY + 12, { font: 'Helvetica', size: 8, color: [0.4, 0.4, 0.4] })
  doc.drawText(data.employee.designation, 110, empBoxY + 12, { font: 'Helvetica', size: 9 })

  // Column 2
  doc.drawText('Employee Code:', 220, empBoxY + 38, { font: 'Helvetica', size: 8, color: [0.4, 0.4, 0.4] })
  doc.drawText(data.employee.code, 220, empBoxY + 25, { font: 'Helvetica-Bold', size: 10 })
  doc.drawText('Company:', 220, empBoxY + 12, { font: 'Helvetica', size: 8, color: [0.4, 0.4, 0.4] })
  doc.drawText(data.company.name, 270, empBoxY + 12, { font: 'Helvetica', size: 9 })

  // Column 3 (Attendance)
  doc.drawText('Days Paid:', 410, empBoxY + 38, { font: 'Helvetica', size: 8, color: [0.4, 0.4, 0.4] })
  doc.drawText(`${data.attendance.daysPaid} Days`, 410, empBoxY + 25, { font: 'Helvetica-Bold', size: 10 })
  doc.drawText('Loss of Pay (LOP):', 410, empBoxY + 12, { font: 'Helvetica', size: 8, color: [0.4, 0.4, 0.4] })
  doc.drawText(`${data.attendance.lopDays} Days`, 495, empBoxY + 12, { font: 'Helvetica-Bold', size: 9, color: [0.7, 0.2, 0.2] })

  // 5. Component Breakdown Table
  let tableY = 635
  doc.setFillColor(0.12, 0.16, 0.2).drawRect(40, tableY - 18, 515.28, 20, true, false)
  doc.drawText('EARNINGS & DEDUCTIONS BREAKDOWN', 50, tableY - 12, {
    font: 'Helvetica-Bold',
    size: 9,
    color: [1, 1, 1],
  })
  doc.drawText('AMOUNT (INR)', 465, tableY - 12, {
    font: 'Helvetica-Bold',
    size: 9,
    color: [1, 1, 1],
  })

  tableY -= 25

  // List Earnings
  doc.setFillColor(0.97, 0.98, 0.98).drawRect(40, tableY - 14, 515.28, 16, true, false)
  doc.drawText('EARNINGS', 50, tableY - 10, { font: 'Helvetica-Bold', size: 8, color: [0.1, 0.5, 0.3] })
  tableY -= 20

  const earnings = data.items.filter((i) => i.type === 'EARNING')
  for (const earn of earnings) {
    doc.drawText(earn.name, 60, tableY, { font: 'Helvetica', size: 9 })
    doc.drawText(`INR ${earn.amount.toFixed(2)}`, 440, tableY, {
      font: 'Helvetica',
      size: 9,
      align: 'right',
      width: 105,
    })
    doc.setStrokeColor(0.92, 0.92, 0.92).setLineWidth(0.5).drawLine(40, tableY - 4, 555.28, tableY - 4)
    tableY -= 16
  }

  // Gross Earnings Subtotal
  doc.setFillColor(0.95, 0.97, 0.96).drawRect(40, tableY - 14, 515.28, 18, true, false)
  doc.drawText('Gross Earnings', 50, tableY - 10, { font: 'Helvetica-Bold', size: 9 })
  doc.drawText(`INR ${data.gross.toFixed(2)}`, 440, tableY - 10, {
    font: 'Helvetica-Bold',
    size: 9,
    align: 'right',
    width: 105,
    color: [0.05, 0.45, 0.25],
  })
  tableY -= 24

  // List Deductions
  doc.setFillColor(0.98, 0.96, 0.96).drawRect(40, tableY - 14, 515.28, 16, true, false)
  doc.drawText('DEDUCTIONS', 50, tableY - 10, { font: 'Helvetica-Bold', size: 8, color: [0.7, 0.2, 0.2] })
  tableY -= 20

  const deductions = data.items.filter((i) => i.type === 'DEDUCTION')
  for (const ded of deductions) {
    doc.drawText(ded.name, 60, tableY, { font: 'Helvetica', size: 9 })
    doc.drawText(`INR ${ded.amount.toFixed(2)}`, 440, tableY, {
      font: 'Helvetica',
      size: 9,
      align: 'right',
      width: 105,
      color: [0.6, 0.1, 0.1],
    })
    doc.setStrokeColor(0.92, 0.92, 0.92).setLineWidth(0.5).drawLine(40, tableY - 4, 555.28, tableY - 4)
    tableY -= 16
  }

  // Deductions Subtotal
  doc.setFillColor(0.98, 0.95, 0.95).drawRect(40, tableY - 14, 515.28, 18, true, false)
  doc.drawText('Total Deductions', 50, tableY - 10, { font: 'Helvetica-Bold', size: 9 })
  doc.drawText(`INR ${data.totalDeductions.toFixed(2)}`, 440, tableY - 10, {
    font: 'Helvetica-Bold',
    size: 9,
    align: 'right',
    width: 105,
    color: [0.7, 0.2, 0.2],
  })
  tableY -= 28

  // 6. Net Pay Callout Box
  doc.setFillColor(0.9, 0.95, 0.95).drawRect(40, tableY - 20, 515.28, 28, true, false)
  doc.setStrokeColor(0.1, 0.5, 0.4).setLineWidth(1).drawRect(40, tableY - 20, 515.28, 28, false, true)
  doc.drawText('NET TAKE-HOME SALARY', 55, tableY - 12, {
    font: 'Helvetica-Bold',
    size: 11,
    color: [0.05, 0.35, 0.35],
  })
  doc.drawText(`INR ${data.netPay.toFixed(2)}`, 420, tableY - 12, {
    font: 'Helvetica-Bold',
    size: 13,
    align: 'right',
    width: 125,
    color: [0.05, 0.45, 0.35],
  })

  // 7. Footer & System Generated Note
  doc.setStrokeColor(0.85, 0.85, 0.85).setLineWidth(0.5).drawLine(40, 70, 555.28, 70)
  doc.drawText(data.systemGeneratedNote, 40, 56, {
    font: 'Helvetica',
    size: 7.5,
    color: [0.5, 0.5, 0.5],
  })
  doc.drawText(`Record ID: ${data.id} | Generated: ${data.period.periodLabel}`, 40, 44, {
    font: 'Helvetica',
    size: 7,
    color: [0.5, 0.5, 0.5],
  })

  return doc.build()
}

/**
 * Generates a server-side Word (.docx) payslip buffer reusing the existing docx library.
 */
export async function generatePayslipDocx(data: PayslipRenderData): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: data.company.name,
            heading: 'Heading1',
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: `Payslip for ${data.period.periodLabel}`,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({ text: '' }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph(`Employee: ${data.employee.name}`)] }),
                  new TableCell({ children: [new Paragraph(`Code: ${data.employee.code}`)] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph(`Designation: ${data.employee.designation}`)] }),
                  new TableCell({ children: [new Paragraph(`Days Paid: ${data.attendance.daysPaid} / LOP: ${data.attendance.lopDays}`)] }),
                ],
              }),
            ],
          }),
          new Paragraph({ text: '' }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: 'Description', children: [new TextRun({ bold: true, text: 'Description' })] })] }),
                  new TableCell({ children: [new Paragraph({ text: 'Amount', children: [new TextRun({ bold: true, text: 'Amount (INR)' })] })] }),
                ],
              }),
              ...data.items.map(
                (item) =>
                  new TableRow({
                    children: [
                      new TableCell({ children: [new Paragraph(item.name)] }),
                      new TableCell({ children: [new Paragraph(`INR ${item.amount.toFixed(2)}`)] }),
                    ],
                  })
              ),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ bold: true, text: 'Net Pay' })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ bold: true, text: `INR ${data.netPay.toFixed(2)}` })] })] }),
                ],
              }),
            ],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            text: data.systemGeneratedNote,
            alignment: AlignmentType.CENTER,
          }),
        ],
      },
    ],
  })

  return await Packer.toBuffer(doc)
}
