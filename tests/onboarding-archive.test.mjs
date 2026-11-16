import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encryptRecord, decryptRecord } from '../src/lib/onboardingArchive.ts'

test('encrypted onboarding record round trips and rejects tampering', () => {
  const original = process.env.ONBOARDING_RECORD_KEY
  process.env.ONBOARDING_RECORD_KEY = 'test-only-key-with-at-least-32-characters'
  try {
    const files = [{ filename: 'application.pdf', content: Buffer.from('private applicant data').toString('base64') }]
    const encrypted = encryptRecord(files)
    assert.equal(encrypted.includes(Buffer.from('private applicant data')), false)
    assert.deepEqual(decryptRecord(encrypted), files)
    const tampered = Buffer.from(encrypted)
    tampered[tampered.length - 1] ^= 1
    assert.throws(() => decryptRecord(tampered))
  } finally {
    if (original === undefined) delete process.env.ONBOARDING_RECORD_KEY
    else process.env.ONBOARDING_RECORD_KEY = original
  }
})
