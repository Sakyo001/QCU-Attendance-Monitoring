// Server-side auth helpers
export {
  getCurrentUser,
  requireRole,
  requireAdmin,
  requireProfessor,
  requireStudent,
} from './auth-helpers.server'

// Client-side auth helpers
export {
  signInWithEmail,
  signUpWithEmail,
  signOut,
  hasRole,
  isAdmin,
  isProfessor,
  isStudent,
} from './auth-helpers.client'

// Shared utilities
export { mapDbUserToAuthUser } from './utils'

