import { DepartmentDefinition, RoleDefinition } from '@/lib/appSettings'
import { Employee, PrimaryDepartment, ScheduleDepartment } from '@/lib/types'

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
