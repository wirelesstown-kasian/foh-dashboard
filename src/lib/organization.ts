import { DepartmentDefinition, RoleDefinition } from '@/lib/appSettings'
import { Employee, PrimaryDepartment, ScheduleDepartment } from '@/lib/types'

type RoleColorTheme = {
  badgeClassName: string
  rowAccentClassName: string
  shiftCardClassName: string
  pdfBadgeBackground: string
  pdfBadgeText: string
  pdfShiftBackground: string
  pdfShiftBorder: string
}

const ROLE_COLOR_THEMES: Record<string, RoleColorTheme> = {
  manager: {
    badgeClassName: 'bg-violet-100 text-violet-800',
    rowAccentClassName: 'border-l-violet-400',
    shiftCardClassName: 'border-violet-200 bg-violet-50',
    pdfBadgeBackground: '#ede9fe',
    pdfBadgeText: '#6d28d9',
    pdfShiftBackground: '#f5f3ff',
    pdfShiftBorder: '#c4b5fd',
  },
  server: {
    badgeClassName: 'bg-sky-100 text-sky-800',
    rowAccentClassName: 'border-l-sky-400',
    shiftCardClassName: 'border-sky-200 bg-sky-50',
    pdfBadgeBackground: '#e0f2fe',
    pdfBadgeText: '#0369a1',
    pdfShiftBackground: '#f0f9ff',
    pdfShiftBorder: '#7dd3fc',
  },
  busser: {
    badgeClassName: 'bg-emerald-100 text-emerald-800',
    rowAccentClassName: 'border-l-emerald-400',
    shiftCardClassName: 'border-emerald-200 bg-emerald-50',
    pdfBadgeBackground: '#d1fae5',
    pdfBadgeText: '#047857',
    pdfShiftBackground: '#ecfdf5',
    pdfShiftBorder: '#86efac',
  },
  runner: {
    badgeClassName: 'bg-amber-100 text-amber-800',
    rowAccentClassName: 'border-l-amber-400',
    shiftCardClassName: 'border-amber-200 bg-amber-50',
    pdfBadgeBackground: '#fef3c7',
    pdfBadgeText: '#b45309',
    pdfShiftBackground: '#fffbeb',
    pdfShiftBorder: '#fcd34d',
  },
  kitchen_staff: {
    badgeClassName: 'bg-rose-100 text-rose-800',
    rowAccentClassName: 'border-l-rose-400',
    shiftCardClassName: 'border-rose-200 bg-rose-50',
    pdfBadgeBackground: '#ffe4e6',
    pdfBadgeText: '#be123c',
    pdfShiftBackground: '#fff1f2',
    pdfShiftBorder: '#fda4af',
  },
}

const DEFAULT_ROLE_COLOR_THEME: RoleColorTheme = {
  badgeClassName: 'bg-slate-100 text-slate-700',
  rowAccentClassName: 'border-l-slate-300',
  shiftCardClassName: 'border-slate-300 bg-slate-50',
  pdfBadgeBackground: '#e2e8f0',
  pdfBadgeText: '#475569',
  pdfShiftBackground: '#f8fafc',
  pdfShiftBorder: '#cbd5e1',
}

export function titleCaseWords(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

export function getRoleLabel(roleKey: string, definitions: RoleDefinition[]) {
  return definitions.find(definition => definition.key === roleKey)?.label ?? titleCaseWords(roleKey)
}

export function getDepartmentLabel(departmentKey: string, definitions: DepartmentDefinition[]) {
  return definitions.find(definition => definition.key === departmentKey)?.label ?? titleCaseWords(departmentKey)
}

export function getRoleColorTheme(roleKey: string): RoleColorTheme {
  return ROLE_COLOR_THEMES[roleKey] ?? DEFAULT_ROLE_COLOR_THEME
}

export function employeeMatchesScheduleDepartment(employee: Employee, department: ScheduleDepartment) {
  const primaryDepartment = employee.primary_department ?? 'foh'
  return primaryDepartment === 'hybrid' || primaryDepartment === department
}

export function getFallbackScheduleDepartment(employee: Employee): ScheduleDepartment {
  const primaryDepartment = employee.primary_department ?? 'foh'
  return primaryDepartment === 'boh' ? 'boh' : 'foh'
}

export function getPrimaryDepartmentBadge(primaryDepartment: PrimaryDepartment | undefined, definitions: DepartmentDefinition[]) {
  return getDepartmentLabel(primaryDepartment ?? 'foh', definitions)
}

export function sortDefinitionsByOrder<T extends { display_order: number; label: string }>(definitions: T[]) {
  return [...definitions].sort((left, right) => left.display_order - right.display_order || left.label.localeCompare(right.label))
}
