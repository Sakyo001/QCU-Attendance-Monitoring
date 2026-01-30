'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { AuthUser, LoginCredentials, SignUpData, AuthContextType } from '@/types/auth.types'
import { signInWithEmail, signUpWithEmail, signOut as authSignOut } from '@/lib/auth/auth-helpers.client'
import { mapDbUserToAuthUser } from '@/lib/auth/utils'

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // Try to restore user from localStorage immediately (instant load)
    try {
      const cachedUser = localStorage.getItem('authUser')
      if (cachedUser) {
        const parsed = JSON.parse(cachedUser)
        setUser(parsed)
        setLoading(false) // Set loading false immediately with cached data
        console.log('Restored user from cache')
      }
    } catch (error) {
      console.error('Error restoring cached user:', error)
    }

    // Check active session in background (non-blocking)
    const checkSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('Error getting session:', error)
          if (!user) setLoading(false) // Only set loading false if no cached user
          return
        }
        
        if (session?.user) {
          console.log('Session found, fetching user data for:', session.user.id)
          await fetchUser(session.user.id)
        } else {
          console.log('No active session found')
          // Check if we still have cached user - if not, set loading false
          const cachedUser = localStorage.getItem('authUser')
          if (!cachedUser) {
            setUser(null)
            setLoading(false)
          }
        }
      } catch (error) {
        console.error('Error checking session:', error)
        if (!user) setLoading(false)
      }
    }

    // Non-blocking: Run in background
    setTimeout(checkSession, 100)

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event)
      if (event === 'SIGNED_IN' && session?.user) {
        await fetchUser(session.user.id)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        localStorage.removeItem('authUser')
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const fetchUser = async (authId: string) => {
    try {
      // Get auth user for email
      const { data: { user: authUser } } = await supabase.auth.getUser()
      
      if (!authUser?.email) {
        setUser(null)
        setLoading(false)
        return
      }

      console.log('Fetching user for email:', authUser.email)
      
      // Try to fetch user from database by email - select only needed fields
      const { data: dbUser, error } = await (supabase as any)
        .from('users')
        .select('id, email, password, role, is_active, first_name, last_name, student_id, employee_id')
        .eq('email', authUser.email as any)
        .limit(1)
        .single()

      // If user not found, create them with default role 'student'
      if (error?.code === 'PGRST116' || !dbUser) {
        console.log('User not found, creating new user record:', authUser.email)
        const newUser = {
          email: authUser.email,
          first_name: authUser.user_metadata?.first_name || 'User',
          last_name: authUser.user_metadata?.last_name || '',
          role: 'student' as const,
          is_active: true,
          password: '' // Set empty password for auth users
        }
        
        const { data: createdUser, error: createError } = await (supabase as any)
          .from('users')
          .insert([newUser as any])
          .select('id, email, password, role, is_active, first_name, last_name, student_id, employee_id')
          .single()

        if (createError) {
          console.error('Error creating user:', createError)
          throw createError
        }

        if (createdUser) {
          console.log('User created successfully:', createdUser.email)
          const mappedUser = mapDbUserToAuthUser(createdUser)
          setUser(mappedUser)
          localStorage.setItem('authUser', JSON.stringify(mappedUser))
        }
      } else if (error) {
        console.error('Supabase error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          status: (error as any).status,
          statusText: (error as any).statusText
        })
        throw error
      } else if (dbUser) {
        console.log('User found and mapped:', dbUser.email)
        const mappedUser = mapDbUserToAuthUser(dbUser)
        setUser(mappedUser)
        localStorage.setItem('authUser', JSON.stringify(mappedUser))
      }
    } catch (error) {
      console.error('Error in fetchUser - Full Error:', error)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  const signIn = async (credentials: LoginCredentials) => {
    try {
      console.log('AuthContext signIn: Starting')
      const result = await signInWithEmail(credentials)
      
      console.log('AuthContext signIn: Result received', result)
      
      if (result.user) {
        console.log('AuthContext signIn: Setting user', result.user)
        setUser(result.user)
        localStorage.setItem('authUser', JSON.stringify(result.user))
        
        console.log('AuthContext signIn: Redirecting to role page:', result.user.role)
        
        // Force immediate redirect based on role
        const targetPath = result.user.role === 'admin' ? '/admin' 
          : result.user.role === 'professor' ? '/professor' 
          : '/student'
        
        console.log('AuthContext signIn: Target path:', targetPath)
        
        // Use window.location for hard redirect instead of router.push
        window.location.href = targetPath
      }
      
      return result
    } catch (error) {
      console.error('AuthContext signIn: Error', error)
      return { user: null, error: error as Error }
    }
  }

  const signUp = async (data: SignUpData) => {
    try {
      const result = await signUpWithEmail(data)
      
      if (result.user) {
        setUser(result.user)
      }
      
      return result
    } catch (error) {
      return { user: null, error: error as Error }
    }
  }

  const signOut = async () => {
    console.log('AuthContext signOut: Starting logout')
    await authSignOut()
    setUser(null)
    localStorage.removeItem('authUser')
    console.log('AuthContext signOut: Cleared user and cache, redirecting')
    // Use window.location for hard redirect to prevent any cached state
    window.location.href = '/'
  }

  const refreshUser = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser) {
      await fetchUser(authUser.id)
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, signUp, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
