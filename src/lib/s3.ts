import crypto from 'node:crypto'

/**
 * Enterprise S3-Compatible Object Storage & Presigned Upload Utility.
 * Supports AWS S3, Cloudflare R2, MinIO, Wasabi, and LocalStack.
 * Implements AWS Signature Version 4 (SigV4) for direct client-to-store PUT uploads,
 * ensuring file bytes are NEVER proxied through the Next.js application server.
 */

export const MAX_DOCUMENT_SIZE = 15 * 1024 * 1024 // 15 Megabytes

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/csv',
  'application/zip',
] as const

export const DOCUMENT_OWNER_TYPES = ['COMPANY', 'EMPLOYEE', 'AUDIT', 'STUDENT'] as const
export type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPES)[number]

export const DOCUMENT_TYPES = [
  'CONTRACT',
  'POLICY',
  'ID_PROOF',
  'RESUME',
  'PAYSLIP',
  'AUDIT_REPORT',
  'OTHER',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export interface DocumentUploadValidationInput {
  ownerType: string
  ownerId: string
  type: string
  mime: string
  size: number
  fileName?: string | null
  expiryDate?: Date | string | null
}

export interface ValidatedDocumentUpload {
  ownerType: DocumentOwnerType
  ownerId: string
  type: DocumentType
  mime: string
  size: number
  fileName: string
  expiryDate: Date | null
}

/**
 * Server-side validation for document uploads (mime type, file size, owner type).
 * Throws explicit descriptive errors on failure.
 */
export function validateDocumentUpload(
  input: DocumentUploadValidationInput
): ValidatedDocumentUpload {
  if (!input) {
    throw new Error('Upload input is required')
  }

  // 1. Validate Owner Type
  const normalizedOwnerType = (input.ownerType || '').trim().toUpperCase() as DocumentOwnerType
  if (!DOCUMENT_OWNER_TYPES.includes(normalizedOwnerType)) {
    throw new Error(
      `Invalid ownerType '${input.ownerType}'. Allowed: ${DOCUMENT_OWNER_TYPES.join(', ')}`
    )
  }

  // 2. Validate Owner Id
  const ownerId = (input.ownerId || '').trim()
  if (!ownerId) {
    throw new Error('ownerId is required')
  }

  // 3. Validate Document Type
  const normalizedType = (input.type || '').trim().toUpperCase() as DocumentType
  if (!DOCUMENT_TYPES.includes(normalizedType)) {
    throw new Error(
      `Invalid document type '${input.type}'. Allowed: ${DOCUMENT_TYPES.join(', ')}`
    )
  }

  // 4. Validate MIME Type
  const normalizedMime = (input.mime || '').trim().toLowerCase()
  if (!ALLOWED_MIME_TYPES.includes(normalizedMime as any)) {
    throw new Error(
      `Invalid or unpermitted file mime type '${input.mime}'. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`
    )
  }

  // 5. Validate File Size
  const size = Number(input.size)
  if (isNaN(size) || size <= 0) {
    throw new Error('File size must be a positive integer in bytes')
  }
  if (size > MAX_DOCUMENT_SIZE) {
    throw new Error(
      `File size (${(size / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of ${(MAX_DOCUMENT_SIZE / (1024 * 1024)).toFixed(0)} MB`
    )
  }

  // 6. Sanitize File Name (extract basename, strip path traversals and illegal characters)
  const baseName = (input.fileName || 'document').split(/[/\\]/).pop() || 'document'
  const fileName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'document'

  // 7. Expiry Date
  let expiryDate: Date | null = null
  if (input.expiryDate) {
    const d = new Date(input.expiryDate)
    if (isNaN(d.getTime())) {
      throw new Error('Invalid expiryDate format')
    }
    expiryDate = d
  }

  return {
    ownerType: normalizedOwnerType,
    ownerId,
    type: normalizedType,
    mime: normalizedMime,
    size,
    fileName,
    expiryDate,
  }
}

/**
 * Generates an isolated, collision-resistant S3 object key.
 */
export function generateDocumentFileKey(
  ownerType: string,
  ownerId: string,
  type: string,
  fileName: string
): string {
  const timestamp = Date.now()
  const randomSuffix = crypto.randomBytes(6).toString('hex')
  const ext = fileName.includes('.') ? fileName.split('.').pop() : 'bin'
  const sanitizedExt = (ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${ownerType.toLowerCase()}s/${ownerId}/${type.toLowerCase()}/${timestamp}-${randomSuffix}.${sanitizedExt}`
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf-8').digest()
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf-8').digest('hex')
}

export interface PresignedPutUrlResult {
  uploadUrl: string
  fileKey: string
  expiresInSeconds: number
  headers: Record<string, string>
  isSimulated: boolean
}

/**
 * Generates an AWS SigV4 signed PUT URL for direct-to-S3 client uploads.
 * If S3 credentials are not configured in environment, produces a safe mock presigned URL for local/CI.
 */
export function generatePresignedPutUrl(
  fileKey: string,
  mime: string,
  expiresInSeconds = 900
): PresignedPutUrlResult {
  const bucket = process.env.S3_BUCKET || 'unihr-documents'
  const region = process.env.S3_REGION || 'ap-south-1'
  const endpoint = process.env.S3_ENDPOINT // e.g. https://<account>.r2.cloudflarestorage.com or MinIO
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY

  const headers = {
    'Content-Type': mime,
  }

  // If live credentials are not present, return simulated URL (local dev / CI testing)
  if (!accessKeyId || !secretAccessKey) {
    const baseUrl = endpoint ? `${endpoint.replace(/\/$/, '')}/${bucket}` : `https://${bucket}.s3.${region}.amazonaws.com`
    const mockUrl = `${baseUrl}/${fileKey}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=${expiresInSeconds}&mock=true`
    return {
      uploadUrl: mockUrl,
      fileKey,
      expiresInSeconds,
      headers,
      isSimulated: true,
    }
  }

  // AWS Signature Version 4 Presigned URL Calculation
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.substring(0, 8)

  const host = endpoint ? new URL(endpoint).host : `${bucket}.s3.${region}.amazonaws.com`
  const canonicalUri = `/${fileKey}`

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`
  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expiresInSeconds.toString(),
    'X-Amz-SignedHeaders': 'content-type;host',
  })

  // Sort query params alphabetically
  queryParams.sort()
  const canonicalQueryString = queryParams.toString()

  const canonicalHeaders = `content-type:${mime}\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const payloadHash = 'UNSIGNED-PAYLOAD'

  const canonicalRequest = `PUT\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`

  // Key derivation
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, 's3')
  const kSigning = hmacSha256(kService, 'aws4_request')

  const signature = hmacSha256(kSigning, stringToSign).toString('hex')

  const protocol = endpoint && endpoint.startsWith('http://') ? 'http' : 'https'
  const uploadUrl = `${protocol}://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`

  return {
    uploadUrl,
    fileKey,
    expiresInSeconds,
    headers,
    isSimulated: false,
  }
}
