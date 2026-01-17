// Database types for Supabase
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'student' | 'professor' | 'admin'
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused'
export type SemesterTerm = 'fall' | 'spring' | 'summer'
export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          auth_id: string | null
          role: UserRole
          email: string
          first_name: string
          last_name: string
          student_id: string | null
          employee_id: string | null
          department_id: string | null
          phone: string | null
          profile_picture_url: string | null
          is_active: boolean
          created_at: string
          updated_at: string
          last_login: string | null
        }
        Insert: {
          id?: string
          auth_id?: string | null
          role: UserRole
          email: string
          first_name: string
          last_name: string
          student_id?: string | null
          employee_id?: string | null
          department_id?: string | null
          phone?: string | null
          profile_picture_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          last_login?: string | null
        }
        Update: {
          id?: string
          auth_id?: string | null
          role?: UserRole
          email?: string
          first_name?: string
          last_name?: string
          student_id?: string | null
          employee_id?: string | null
          department_id?: string | null
          phone?: string | null
          profile_picture_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          last_login?: string | null
        }
      }
      departments: {
        Row: {
          id: string
          name: string
          code: string
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          code: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          code?: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      attendance_records: {
        Row: {
          id: string
          student_id: string
          section_id: string
          date: string
          status: AttendanceStatus
          time_recorded: string
          location: string | null
          verification_method: string | null
          confidence_score: number | null
          notes: string | null
          marked_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          student_id: string
          section_id: string
          date?: string
          status?: AttendanceStatus
          time_recorded?: string
          location?: string | null
          verification_method?: string | null
          confidence_score?: number | null
          notes?: string | null
          marked_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          student_id?: string
          section_id?: string
          date?: string
          status?: AttendanceStatus
          time_recorded?: string
          location?: string | null
          verification_method?: string | null
          confidence_score?: number | null
          notes?: string | null
          marked_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      user_role: UserRole
      attendance_status: AttendanceStatus
      semester_term: SemesterTerm
      day_of_week: DayOfWeek
    }
  }
}
