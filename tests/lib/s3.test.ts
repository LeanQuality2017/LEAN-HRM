import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  validateDocumentUpload,
  generateDocumentFileKey,
  generatePresignedPutUrl,
  MAX_DOCUMENT_SIZE,
  ALLOWED_MIME_TYPES,
  DOCUMENT_OWNER_TYPES,
  DOCUMENT_TYPES,
} from '@/lib/s3'

describe('Document Upload Validation (Pure Function)', () => {
  it('accepts valid document upload parameters', () => {
    const input = {
      ownerType: 'COMPANY',
      ownerId: 'comp_123',
      type: 'CONTRACT',
      mime: 'application/pdf',
      size: 1024 * 500, // 500 KB
      fileName: 'Employment_Agreement.pdf',
      expiryDate: '2027-12-31T00:00:00.000Z',
    }

    const result = validateDocumentUpload(input)
    expect(result.ownerType).toBe('COMPANY')
    expect(result.ownerId).toBe('comp_123')
    expect(result.type).toBe('CONTRACT')
    expect(result.mime).toBe('application/pdf')
    expect(result.size).toBe(512000)
    expect(result.fileName).toBe('Employment_Agreement.pdf')
    expect(result.expiryDate?.toISOString()).toBe('2027-12-31T00:00:00.000Z')
  })

  it('permits all allowed MIME types', () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      const result = validateDocumentUpload({
        ownerType: 'EMPLOYEE',
        ownerId: 'emp_001',
        type: 'ID_PROOF',
        mime,
        size: 1024,
      })
      expect(result.mime).toBe(mime)
    }
  })

  it('rejects disallowed MIME types', () => {
    const dangerousMimes = [
      'application/x-msdownload', // .exe
      'text/html',
      'application/javascript',
      'image/svg+xml', // XML with embedded scripts
      'application/x-sh',
      'text/php',
    ]

    for (const badMime of dangerousMimes) {
      expect(() =>
        validateDocumentUpload({
          ownerType: 'EMPLOYEE',
          ownerId: 'emp_001',
          type: 'RESUME',
          mime: badMime,
          size: 2048,
        })
      ).toThrow(/Invalid or unpermitted file mime type/)
    }
  })

  it('rejects file sizes <= 0 bytes or NaN', () => {
    expect(() =>
      validateDocumentUpload({
        ownerType: 'AUDIT',
        ownerId: 'aud_1',
        type: 'AUDIT_REPORT',
        mime: 'application/pdf',
        size: 0,
      })
    ).toThrow(/File size must be a positive integer/)

    expect(() =>
      validateDocumentUpload({
        ownerType: 'AUDIT',
        ownerId: 'aud_1',
        type: 'AUDIT_REPORT',
        mime: 'application/pdf',
        size: -100,
      })
    ).toThrow(/File size must be a positive integer/)

    expect(() =>
      validateDocumentUpload({
        ownerType: 'AUDIT',
        ownerId: 'aud_1',
        type: 'AUDIT_REPORT',
        mime: 'application/pdf',
        size: NaN,
      })
    ).toThrow(/File size must be a positive integer/)
  })

  it('accepts files exactly at MAX_DOCUMENT_SIZE and rejects anything larger', () => {
    const validAtLimit = validateDocumentUpload({
      ownerType: 'COMPANY',
      ownerId: 'comp_1',
      type: 'POLICY',
      mime: 'application/pdf',
      size: MAX_DOCUMENT_SIZE,
    })
    expect(validAtLimit.size).toBe(MAX_DOCUMENT_SIZE)

    expect(() =>
      validateDocumentUpload({
        ownerType: 'COMPANY',
        ownerId: 'comp_1',
        type: 'POLICY',
        mime: 'application/pdf',
        size: MAX_DOCUMENT_SIZE + 1,
      })
    ).toThrow(/exceeds maximum allowed limit/)
  })

  it('rejects invalid owner types', () => {
    expect(() =>
      validateDocumentUpload({
        ownerType: 'UNKNOWN_ENTITY',
        ownerId: 'id_123',
        type: 'OTHER',
        mime: 'application/pdf',
        size: 1024,
      })
    ).toThrow(/Invalid ownerType/)
  })

  it('rejects missing ownerId', () => {
    expect(() =>
      validateDocumentUpload({
        ownerType: 'COMPANY',
        ownerId: '   ',
        type: 'POLICY',
        mime: 'application/pdf',
        size: 1024,
      })
    ).toThrow(/ownerId is required/)
  })

  it('rejects invalid document types', () => {
    expect(() =>
      validateDocumentUpload({
        ownerType: 'COMPANY',
        ownerId: 'comp_1',
        type: 'MALICIOUS_TYPE',
        mime: 'application/pdf',
        size: 1024,
      })
    ).toThrow(/Invalid document type/)
  })

  it('sanitizes fileName by stripping directory traversal and illegal characters', () => {
    const result = validateDocumentUpload({
      ownerType: 'EMPLOYEE',
      ownerId: 'emp_1',
      type: 'RESUME',
      mime: 'application/pdf',
      size: 1024,
      fileName: '../../../etc/my resume (1).pdf',
    })
    expect(result.fileName).not.toContain('/')
    expect(result.fileName).not.toContain('\\')
    expect(result.fileName).toBe('my_resume__1_.pdf')
  })

  it('handles optional and invalid expiryDate', () => {
    const noExpiry = validateDocumentUpload({
      ownerType: 'EMPLOYEE',
      ownerId: 'emp_1',
      type: 'PAYSLIP',
      mime: 'application/pdf',
      size: 1024,
    })
    expect(noExpiry.expiryDate).toBeNull()

    expect(() =>
      validateDocumentUpload({
        ownerType: 'EMPLOYEE',
        ownerId: 'emp_1',
        type: 'PAYSLIP',
        mime: 'application/pdf',
        size: 1024,
        expiryDate: 'invalid-date-format',
      })
    ).toThrow(/Invalid expiryDate format/)
  })
})

describe('S3 Key and Presigned URL Generation', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('generates an isolated, collision-resistant S3 object key', () => {
    const key1 = generateDocumentFileKey('EMPLOYEE', 'emp_abc', 'RESUME', 'resume.pdf')
    const key2 = generateDocumentFileKey('EMPLOYEE', 'emp_abc', 'RESUME', 'resume.pdf')

    expect(key1).toMatch(/^employees\/emp_abc\/resume\/\d+-[a-f0-9]+\.pdf$/)
    expect(key2).toMatch(/^employees\/emp_abc\/resume\/\d+-[a-f0-9]+\.pdf$/)
    // Keys generated consecutively must be distinct
    expect(key1).not.toBe(key2)
  })

  it('generates simulated presigned URL in dev/test when credentials are unset', () => {
    delete process.env.S3_ACCESS_KEY_ID
    delete process.env.S3_SECRET_ACCESS_KEY

    const fileKey = 'employees/emp_1/resume/test.pdf'
    const result = generatePresignedPutUrl(fileKey, 'application/pdf')

    expect(result.isSimulated).toBe(true)
    expect(result.fileKey).toBe(fileKey)
    expect(result.uploadUrl).toContain(fileKey)
    expect(result.uploadUrl).toContain('mock=true')
    expect(result.headers['Content-Type']).toBe('application/pdf')
  })

  it('generates AWS SigV4 signed presigned URL when credentials are configured', () => {
    process.env.S3_ACCESS_KEY_ID = 'TEST_AWS_KEY'
    process.env.S3_SECRET_ACCESS_KEY = 'TEST_AWS_SECRET'
    process.env.S3_BUCKET = 'unihr-vault'
    process.env.S3_REGION = 'ap-south-1'

    const fileKey = 'companies/comp_1/contract/agreement.pdf'
    const result = generatePresignedPutUrl(fileKey, 'application/pdf', 900)

    expect(result.isSimulated).toBe(false)
    expect(result.fileKey).toBe(fileKey)
    expect(result.uploadUrl).toContain('https://unihr-vault.s3.ap-south-1.amazonaws.com/')
    expect(result.uploadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256')
    expect(result.uploadUrl).toContain('X-Amz-Credential=TEST_AWS_KEY%2F')
    expect(result.uploadUrl).toContain('X-Amz-Signature=')
    expect(result.headers['Content-Type']).toBe('application/pdf')
  })
})
