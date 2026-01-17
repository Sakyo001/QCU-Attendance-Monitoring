import { Database } from '@/types/database.types'
import { AuthUser } from '@/types/auth.types'

// Convert database user to AuthUser type (utility function, no server action needed)
export function mapDbUserToAuthUser(dbUser: any): AuthUser {
  return {
    id: dbUser.id,
    email: dbUser.email,
    role: dbUser.role,
    firstName: dbUser.first_name,
    lastName: dbUser.last_name,
    employeeId: dbUser.employee_id || null,
    studentId: dbUser.student_id || null,
    departmentId: dbUser.department_id || null,
    profilePictureUrl: dbUser.profile_picture_url || null,
    isActive: dbUser.is_active,
  }
}
