import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PDFDocument } from 'pdf-lib'
import { prefillOnboardingForm } from '../src/lib/onboardingForms.ts'

const employee = { first_name: 'Test', last_name: 'Employee', address: '10 Main St', address_city: 'Northbrook', address_state: 'IL', address_postal_code: '60062', email: 'test@example.com', phone: '5551234567', activation_date: '2026-11-20' }
const company = { legal_name: 'Test Restaurant Inc.', street: '100 Company Ave', city: 'Northbrook', state: 'Illinois', postal_code: '60062', ein: '00-0000000' }

test('official W-4 gets applicant and employer fields while signature stays blank', async () => {
  const template = await readFile('public/forms/w4-2026.pdf')
  const result = await PDFDocument.load(await prefillOnboardingForm('w4', template, employee, company, '123456789'))
  const form = result.getForm()
  assert.equal(form.getTextField('topmostSubform[0].Page1[0].Step1a[0].f1_01[0]').getText(), 'Test')
  assert.equal(form.getTextField('topmostSubform[0].Page1[0].f1_14[0]').getText(), company.ein)
  assert.equal(form.getTextField('topmostSubform[0].Page1[0].f1_13[0]').getText(), '11/20/2026')
})

test('official I-9 gets entered information but leaves attestations and signatures blank', async () => {
  const template = await readFile('public/forms/i9.pdf')
  const result = await PDFDocument.load(await prefillOnboardingForm('i9', template, employee, company, '123456789'))
  const form = result.getForm()
  assert.equal(form.getTextField('First Name Given Name').getText(), 'Test')
  assert.equal(form.getTextField('Employers Business or Org Name').getText(), company.legal_name)
  assert.equal(form.getTextField('FirstDayEmployed mmddyyyy').getText(), '11/20/2026')
  assert.equal(form.getTextField('Signature of Employee').getText(), undefined)
  assert.equal(form.getTextField('Signature of Employer or AR').getText(), undefined)
})
