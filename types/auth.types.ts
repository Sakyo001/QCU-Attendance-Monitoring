import { UserRole } from './database.types'

export interface AuthUser {
  id: string
  email: string
  role: UserRole
  firstName: string
  lastName: string
  employeeId?: string | null
  studentId?: string | null
  departmentId?: string | null
  profilePictureUrl?: string | null
  isActive: boolean
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface SignUpData extends LoginCredentials {
  firstName: string
  lastName: string
  role: UserRole
  employeeId?: string
  studentId?: string
  departmentId?: string
}

export interface AuthResponse {
  user: AuthUser | null
  error: Error | null
}

export interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  signIn: (credentials: LoginCredentials) => Promise<AuthResponse>
  signOut: () => Promise<void>
  signUp: (data: SignUpData) => Promise<AuthResponse>
  refreshUser: () => Promise<void>
}
