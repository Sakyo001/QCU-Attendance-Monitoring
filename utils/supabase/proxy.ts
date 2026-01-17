import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { Database } from '@/types/database.types'

const protectedRoutes = {
  admin: ['/admin', '/admin/'],
  professor: ['/professor', '/professor/'],
  student: ['/student', '/student/'],
}

const loginRoutes = {
  admin: '/admin/login',
  professor: '/professor/login',
  student: '/student/login',
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as CookieOptions)
          )
        },
      },
    }
  )

  // Check if trying to access protected routes
  const isAdminRoute = pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')
  const isProfessorRoute = pathname.startsWith('/professor') && !pathname.startsWith('/professor/login')
  const isStudentRoute = pathname.startsWith('/student') && !pathname.startsWith('/student/login')

  // For login pages and public routes, skip auth check
  if (!isAdminRoute && !isProfessorRoute && !isStudentRoute) {
    return response
  }

  // Use getUser() for security (authenticates with server)
  const { data: { user } } = await supabase.auth.getUser()

  // If not logged in and accessing protected routes, redirect to login
  if (!user) {
    if (isAdminRoute) {
      return NextResponse.redirect(new URL(loginRoutes.admin, request.url))
    }
    if (isProfessorRoute) {
      return NextResponse.redirect(new URL(loginRoutes.professor, request.url))
    }
    if (isStudentRoute) {
      return NextResponse.redirect(new URL(loginRoutes.student, request.url))
    }
    return response
  }

  // User is logged in - get their role (only one query)
  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('auth_id', user.id)
    .single()

  const userRole = userData?.role

  // If no role found, let AuthContext handle the redirect
  if (!userRole) {
    return response
  }

  // Check role-based access
  if (isAdminRoute && userRole !== 'admin') {
    return NextResponse.redirect(new URL('/', request.url))
  }
  if (isProfessorRoute && userRole !== 'professor' && userRole !== 'adviser') {
    return NextResponse.redirect(new URL('/', request.url))
  }
  if (isStudentRoute && userRole !== 'student') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  matcher: [
    // Match protected routes
    '/admin/:path*',
    '/professor/:path*',
    '/student/:path*',
  ],
}


