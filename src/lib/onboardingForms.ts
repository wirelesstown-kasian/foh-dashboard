import { PDFDocument } from 'pdf-lib'

export type ApplicantForForms = {
  first_name: string; last_name: string; address: string; address_city: string;
  address_state: string; address_postal_code: string; email: string; phone: string;
  activation_date: string | null
}
export type EmployerForForms = {
  legal_name: string; street: string; city: string; state: string;
  postal_code: string; ein: string
}

export async function prefillOnboardingForm(kind: 'w4' | 'i9', template: Uint8Array, row: ApplicantForForms, employer: EmployerForForms, ssn: string) {
  const pdf = await PDFDocument.load(template)
  const form = pdf.getForm()
  const set = (field: string, value: string | null | undefined) => { if (value) form.getTextField(field).setText(value) }
  const address = `${row.address_city ?? ''}, ${row.address_state ?? ''} ${row.address_postal_code ?? ''}`.trim()
  const startDate = row.activation_date ? `${row.activation_date.slice(5, 7)}/${row.activation_date.slice(8, 10)}/${row.activation_date.slice(0, 4)}` : ''
  if (kind === 'w4') {
    set('topmostSubform[0].Page1[0].Step1a[0].f1_01[0]', row.first_name)
    set('topmostSubform[0].Page1[0].Step1a[0].f1_02[0]', row.last_name)
    set('topmostSubform[0].Page1[0].Step1a[0].f1_03[0]', row.address)
    set('topmostSubform[0].Page1[0].Step1a[0].f1_04[0]', address)
    set('topmostSubform[0].Page1[0].f1_05[0]', ssn)
    set('topmostSubform[0].Page1[0].f1_12[0]', `${employer.legal_name}\n${employer.street}, ${employer.city}, ${employer.state} ${employer.postal_code}`)
    set('topmostSubform[0].Page1[0].f1_13[0]', startDate)
    set('topmostSubform[0].Page1[0].f1_14[0]', employer.ein)
  } else {
    set('First Name Given Name', row.first_name)
    set('Last Name (Family Name)', row.last_name)
    set('Address Street Number and Name', row.address)
    set('City or Town', row.address_city)
    if (row.address_state) form.getDropdown('State').select(row.address_state.toUpperCase())
    set('ZIP Code', row.address_postal_code)
    set('Employees E-mail Address', row.email)
    set('Telephone Number', row.phone)
    set('US Social Security Number', ssn)
    set('FirstDayEmployed mmddyyyy', startDate)
    set('Employers Business or Org Name', employer.legal_name)
    set('Employers Business or Org Address', `${employer.street}, ${employer.city}, ${employer.state} ${employer.postal_code}`)
  }
  return pdf.save()
}
