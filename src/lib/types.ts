export type EmployeeRole = 'manager' | 'server' | 'busser' | 'runner' | 'kitchen_staff'
export type TaskType = 'pre_shift' | 'operation' | 'closing' | 'custom'
export type SessionPhase = 'pre_shift' | 'operation' | 'closing' | 'complete'
export type ScheduleDepartment = 'foh' | 'boh'
export type TaskCompletionStatus = 'complete' | 'incomplete'

export interface Employee {
  id: string
  name: string
  phone: string | null
  email: string | null
  pin_hash: string
  role: EmployeeRole
  birth_date: string | null
  is_active: boolean
  created_at: string
}

export interface Schedule {
  id: string
  employee_id: string
  date: string
  start_time: string
  end_time: string
  created_at: string
  employee?: Employee
}

export interface TaskCategory {
  id: string
  name: string
  type: TaskType
  deadline_time: string | null
  display_order: number
  is_active: boolean
  created_at: string
  tasks?: Task[]
}

export interface Task {
  id: string
  category_id: string
  title: string
  deadline_time: string | null
  display_order: number
  is_active: boolean
  created_at: string
  days_of_week: number[] | null
  category?: TaskCategory
}

export interface TaskCompletion {
  id: string
  task_id: string
  employee_id: string
  completed_at: string
  session_date: string
  status?: TaskCompletionStatus
  employee?: Employee
  task?: Task
}

export interface DailySession {
  id: string
  session_date: string
  current_phase: SessionPhase
  notes: string | null
  completed_at: string | null
}

export interface EodReport {
  id: string
  session_date: string
  closed_by_employee_id: string | null
  cash_total: number
  batch_total: number
  revenue_total: number
  cc_tip: number
  cash_tip: number
  tip_total: number
  cash_deposit: number
  memo: string | null
  created_at: string
  updated_at: string
  closed_by?: Employee
  tip_distributions?: TipDistribution[]
}

export interface TipDistribution {
  id: string
  eod_report_id: string
  employee_id: string
  start_time: string | null
  end_time: string | null
  hours_worked: number
  tip_share: number
  house_deduction: number
  net_tip: number
  employee?: Employee
}
