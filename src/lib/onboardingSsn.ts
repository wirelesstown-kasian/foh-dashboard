import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function key() {
  const secret = process.env.ONBOARDING_RECORD_KEY
  if (!secret || secret.length < 32) throw new Error('ONBOARDING_RECORD_KEY must be configured before collecting SSNs')
  return createHash('sha256').update(secret).digest()
}

export function encryptSsn(ssn: string) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), nonce)
  return Buffer.concat([nonce, cipher.update(ssn, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64')
}

export function decryptSsn(value: string) {
  const bytes = Buffer.from(value, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(bytes.length - 16))
  return Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]).toString('utf8')
}
