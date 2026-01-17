# Authentication System Implementation

## Overview
Complete authentication system for Admin and Professor (Adviser) roles using Supabase.

## Setup Instructions

### 1. Configure Environment Variables
Edit [.env.local](.env.local) with your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=your-project-url.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### 2. Deploy Database Schema
1. Create a Supabase project at https://supabase.com
2. Go to SQL Editor
3. Run [supabase/schema.sql](supabase/schema.sql)

### 3. Create Test Users

#### Option A: Using Supabase Dashboard
1. Go to Authentication > Users
2. Click "Add User" and create accounts with emails
3. Then run this SQL to link them to your users table:

```sql
-- Create Admin User
INSERT INTO users (
  auth_id, 
  role, 
  email, 
  first_name, 
  last_name, 
  employee_id, 
  is_active
) VALUES (
  'paste-auth-id-from-dashboard',
  'admin',
  'admin@university.edu',
  'System',
  'Administrator',
  'ADM-001',
  true
);

-- Create Professor User
INSERT INTO users (
  auth_id,
  role,
  email,
  first_name,
  last_name,
  employee_id,
  is_active
) VALUES (
  'paste-auth-id-from-dashboard',
  'professor',
  'professor@university.edu',
  'John',
  'Doe',
  'FAC-001',
  true
);
```

#### Option B: Using API (Recommended for Development)
Create an API route to register users programmatically (requires service role key).

### 4. Test Authentication

1. **Start Development Server:**
```bash
npm run dev
```

2. **Test Admin Login:**
   - Visit http://localhost:3000/admin/login
   - Enter admin credentials
   - Should redirect to `/admin/dashboard`

3. **Test Professor Login:**
   - Visit http://localhost:3000/professor/login
   - Enter professor credentials
   - Should redirect to `/professor/dashboard`

## File Structure

### Core Files
- [types/database.types.ts](types/database.types.ts) - Database type definitions
- [types/auth.types.ts](types/auth.types.ts) - Authentication type definitions
- [lib/auth/auth-helpers.ts](lib/auth/auth-helpers.ts) - Server & client auth utilities
- [contexts/AuthContext.tsx](contexts/AuthContext.tsx) - React context for auth state
- [middleware.ts](middleware.ts) - Next.js middleware for route protection

### Login Pages
- [app/admin/login/page.tsx](app/admin/login/page.tsx) - Admin login form
- [app/professor/login/page.tsx](app/professor/login/page.tsx) - Professor login form

### Utility Components
- [lib/auth/route-guards.tsx](lib/auth/route-guards.tsx) - Client-side route guards
- [components/auth/protected-route.tsx](components/auth/protected-route.tsx) - Protected route wrapper
- [hooks/useRequireAuth.ts](hooks/useRequireAuth.ts) - Authentication hooks

### Supabase Clients
- [utils/supabase/client.ts](utils/supabase/client.ts) - Browser client
- [utils/supabase/server.ts](utils/supabase/server.ts) - Server client
- [utils/supabase/middleware.ts](utils/supabase/middleware.ts) - Middleware client

## Features Implemented

### ✅ User Authentication
- Email/password login
- Role-based authentication (admin, professor, student)
- Session management
- Auto-redirect based on role

### ✅ Route Protection
- Middleware-level protection
- Client-side route guards
- Role-based access control
- Automatic redirects for unauthorized access

### ✅ Security Features
- Row Level Security (RLS) policies
- Active account checking
- Last login tracking
- Secure session handling

### ✅ User Experience
- Loading states
- Error handling
- Forgot password links (ready for implementation)
- Responsive design
- Modern UI with gradient backgrounds

## Usage Examples

### Using Auth Context in Components
```tsx
'use client'

import { useAuth } from '@/contexts/AuthContext'

export default function MyComponent() {
  const { user, loading, signOut } = useAuth()

  if (loading) return <div>Loading...</div>

  return (
    <div>
      <p>Welcome, {user?.firstName}!</p>
      <button onClick={signOut}>Sign Out</button>
    </div>
  )
}
```

### Protecting Routes
```tsx
import { AdminGuard } from '@/lib/auth/route-guards'

export default function AdminPage() {
  return (
    <AdminGuard>
      <div>Admin-only content</div>
    </AdminGuard>
  )
}
```

### Server-Side Auth Check
```tsx
import { getCurrentUser } from '@/lib/auth/auth-helpers'
import { redirect } from 'next/navigation'

export default async function ServerPage() {
  const user = await getCurrentUser()
  
  if (!user || user.role !== 'admin') {
    redirect('/admin/login')
  }

  return <div>Hello {user.firstName}</div>
}
```

### Using Auth Hooks
```tsx
'use client'

import { useRequireAdmin } from '@/hooks/useRequireAuth'

export default function AdminDashboard() {
  const { user, loading } = useRequireAdmin()

  if (loading) return <div>Loading...</div>

  return <div>Admin Dashboard for {user?.firstName}</div>
}
```

## API Helper Functions

### Client-Side
- `signInWithEmail(credentials)` - Sign in user
- `signUpWithEmail(data)` - Register new user
- `signOut()` - Sign out current user
- `hasRole(user, roles)` - Check if user has role
- `isAdmin(user)` - Check if user is admin
- `isProfessor(user)` - Check if user is professor

### Server-Side
- `getCurrentUser()` - Get authenticated user
- `requireRole(allowedRoles)` - Require specific role
- `requireAdmin()` - Require admin role
- `requireProfessor()` - Require professor role

## Middleware Protection

The middleware automatically:
1. Refreshes expired sessions
2. Redirects unauthenticated users to login
3. Validates user roles against route requirements
4. Redirects users to their appropriate dashboard
5. Checks account active status

Protected routes:
- `/admin/*` - Admin only
- `/professor/*` - Professor only
- `/student/*` - Student only

## Next Steps

1. ✅ Set up Supabase project
2. ✅ Configure environment variables
3. ✅ Deploy database schema
4. ⏳ Create test users
5. ⏳ Test login flows
6. ⏳ Implement password reset
7. ⏳ Add email verification
8. ⏳ Implement facial recognition enrollment

## Troubleshooting

### "Invalid credentials" error
- Verify email/password are correct
- Check user exists in both `auth.users` and `users` table
- Ensure `auth_id` matches between tables

### Infinite redirect loop
- Check middleware configuration
- Verify environment variables are set
- Clear browser cookies and try again

### "Account is inactive" error
- Update user record: `UPDATE users SET is_active = true WHERE email = 'user@email.com'`

### Type errors
- Run `npm install` to ensure all dependencies are installed
- Restart TypeScript server in VS Code

## Security Considerations

1. **Never expose service role key** - Only use in server-side API routes
2. **Use HTTPS in production** - Supabase requires secure connections
3. **Implement rate limiting** - Prevent brute force attacks
4. **Regular security audits** - Review RLS policies periodically
5. **Strong password requirements** - Enforce in Supabase Auth settings
