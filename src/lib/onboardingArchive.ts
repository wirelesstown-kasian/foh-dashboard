import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ARCHIVE_HEADER = Buffer.from('NVONBOARD1')

function archiveKey() {
  const secret = process.env.ONBOARDING_RECORD_KEY
  if (!secret || secret.length < 32) throw new Error('ONBOARDING_RECORD_KEY must be configured with at least 32 random characters')
  return createHash('sha256').update(secret).digest()
}

export function encryptRecord(files: Array<{ filename: string; content: string }>) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', archiveKey(), nonce)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ version: 1, files }), 'utf8'), cipher.final()])
  return Buffer.concat([ARCHIVE_HEADER, nonce, cipher.getAuthTag(), encrypted])
}

export function decryptRecord(bytes: Buffer) {
  if (!bytes.subarray(0, ARCHIVE_HEADER.length).equals(ARCHIVE_HEADER)) throw new Error('Invalid onboarding archive')
  const nonce = bytes.subarray(ARCHIVE_HEADER.length, ARCHIVE_HEADER.length + 12)
  const tag = bytes.subarray(ARCHIVE_HEADER.length + 12, ARCHIVE_HEADER.length + 28)
  const decipher = createDecipheriv('aes-256-gcm', archiveKey(), nonce)
  decipher.setAuthTag(tag)
  const decoded = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(ARCHIVE_HEADER.length + 28)), decipher.final()]).toString('utf8')) as { version: number; files: Array<{ filename: string; content: string }> }
  if (decoded.version !== 1 || !Array.isArray(decoded.files)) throw new Error('Unsupported onboarding archive')
  return decoded.files
}
