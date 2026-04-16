export type EmployeeRole = string
export type TaskType = 'pre_shift' | 'operation' | 'closing' | 'custom'
export type SessionPhase = 'register_open' | 'pre_shift' | 'operation' | 'closing' | 'complete'
export type ScheduleDepartment = 'foh' | 'boh'
export type PrimaryDepartment = 'foh' | 'boh' | 'hybrid' | string
export type TaskCompletionStatus = 'complete' | 'incomplete'
export type ShiftClockApprovalStatus = 'open' | 'pending_review' | 'approved' | 'adjusted'

export interface Employee {
  id: string
  name: string
  phone: string | null
  email: string | null
  pin_hash?: string
  role: EmployeeRole
  primary_department?: PrimaryDepartment
  hourly_wage: number | null
  guaranteed_hourly: number | null
  birth_date: string | null
  login_enabled?: boolean
  is_active: boolean
  created_at: string
}

export interface Schedule {
  id: string
  employee_id: string
  date: string
  start_time: string
  end_time: string
  department?: ScheduleDepartment
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
  starting_cash: number | null
  register_opened_by: string | null
}

export interface EodReport {
  id: string
  session_date: string
  closed_by_employee_id: string | null
  starting_cash: number
  cash_total: number
  batch_total: number
  revenue_total: number
  cc_tip: number
  cash_tip: number
  tip_total: number
  cash_deposit: number
  actual_cash_on_hand: number
  cash_variance: number
  variance_note: string | null
  sales_tax: number | null
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

export interface ShiftClock {
  id: string
  session_date: string
  employee_id: string
  clock_in_at: string
  clock_out_at: string | null
  clock_in_photo_path: string
  clock_out_photo_path: string | null
  auto_clock_out: boolean
  approval_status: ShiftClockApprovalStatus
  approved_hours: number | null
  manager_approved_by: string | null
  manager_approved_at: string | null
  manager_note: string | null
  created_at: string
  updated_at: string
  employee?: Employee
  clock_in_photo_url?: string | null
  clock_out_photo_url?: string | null
}

export type CashBalanceEntryType = 'cash_in' | 'cash_out'

export interface CashBalanceEntry {
  id: string
  entry_date: string
  entry_type: CashBalanceEntryType
  amount: number
  description: string
  created_at: string
  updated_at: string
}
