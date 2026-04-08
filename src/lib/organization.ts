import { DepartmentDefinition, RoleDefinition } from '@/lib/appSettings'
import { Employee, PrimaryDepartment, ScheduleDepartment } from '@/lib/types'

type RoleColorTheme = {
  badgeStyle: { backgroundColor: string; color: string }
  rowAccentStyle: { borderLeftColor: string }
  shiftCardStyle: { backgroundColor: string; borderColor: string }
  pdfBadgeBackground: string
  pdfBadgeText: string
  pdfShiftBackground: string
  pdfShiftBorder: string
}

const DEFAULT_ROLE_COLORS: Record<string, string> = {
  manager: '#8b5cf6',
  server: '#0ea5e9',
  busser: '#10b981',
  runner: '#f59e0b',
  kitchen_staff: '#f43f5e',
}

function hexToRgb(hexColor: string) {
  const normalized = hexColor.replace('#', '')
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return { red, green, blue }
}

function mixHex(hexColor: string, targetHex: string, weight: number) {
  const source = hexToRgb(hexColor)
  const target = hexToRgb(targetHex)
  const mix = (left: number, right: number) => Math.round(left * (1 - weight) + right * weight)
  return `#${[mix(source.red, target.red), mix(source.green, target.green), mix(source.blue, target.blue)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')}`
}

function getContrastTextColor(hexColor: string) {
  const { red, green, blue } = hexToRgb(hexColor)
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  return luminance > 0.62 ? '#0f172a' : '#ffffff'
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

export function getRoleColorTheme(roleKey: string, definitions: RoleDefinition[] = []): RoleColorTheme {
  const definitionColor = definitions.find(definition => definition.key === roleKey)?.color
  const baseColor = definitionColor ?? DEFAULT_ROLE_COLORS[roleKey] ?? '#64748b'
  return {
    badgeStyle: {
      backgroundColor: mixHex(baseColor, '#ffffff', 0.84),
      color: mixHex(baseColor, '#0f172a', 0.18),
    },
    rowAccentStyle: {
      borderLeftColor: mixHex(baseColor, '#ffffff', 0.2),
    },
    shiftCardStyle: {
      backgroundColor: mixHex(baseColor, '#ffffff', 0.9),
      borderColor: mixHex(baseColor, '#ffffff', 0.72),
    },
    pdfBadgeBackground: mixHex(baseColor, '#ffffff', 0.84),
    pdfBadgeText: mixHex(baseColor, '#0f172a', 0.18),
    pdfShiftBackground: mixHex(baseColor, '#ffffff', 0.9),
    pdfShiftBorder: mixHex(baseColor, '#ffffff', 0.72),
  }
}

export function getRoleDefinition(roleKey: string, definitions: RoleDefinition[]) {
  return definitions.find(definition => definition.key === roleKey) ?? null
}

export function getRoleDotStyle(roleKey: string, definitions: RoleDefinition[] = []) {
  const definitionColor = definitions.find(definition => definition.key === roleKey)?.color
  const backgroundColor = definitionColor ?? DEFAULT_ROLE_COLORS[roleKey] ?? '#64748b'
  return {
    backgroundColor,
    color: getContrastTextColor(backgroundColor),
  }
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
