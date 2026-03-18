'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck, Mail, Lock, AlertCircle, Eye, EyeOff, LogIn, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export default function AdminLoginPage() {
  const router = useRouter()
  const { user, loading, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Redirect already authenticated admins
  useEffect(() => {
    if (!loading && user && user.role === 'admin') {
      router.push('/admin')
    }
  }, [user, loading, router])

  // Show loading while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-slate-600 font-medium">Verifying credentials...</p>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      console.log('Attempting login with:', email)
      const { user, error } = await signIn({ email, password })

      if (error) {
        console.error('Login error:', error)
        setError(error.message)
        setIsLoading(false)
        return
      }

      if (!user) {
        console.error('No user returned from signIn')
        setError('Login failed. Please try again.')
        setIsLoading(false)
        return
      }

      if (user.role !== 'admin') {
        console.error('User is not admin:', user.role)
        setError('Access denied. Admin credentials required.')
        setIsLoading(false)
        return
      }

      console.log('Login successful, redirecting...')
      // Redirect will be handled by AuthContext
      // Keep loading true during redirect
    } catch (err) {
      console.error('Unexpected error:', err)
      setError('An unexpected error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 sm:p-8">
      <div className="w-full max-w-5xl">
        <div className="bg-white rounded-[2rem] shadow-2xl overflow-hidden flex flex-col lg:flex-row border border-slate-100">
          
          {/* Left Panel - Info & Branding */}
          <div className="w-full lg:w-5/12 bg-gradient-to-br from-violet-600 to-purple-800 p-8 lg:p-12 flex flex-col items-center lg:items-start text-center lg:text-left relative overflow-hidden">
            {/* Decorative Elements */}
            <div className="absolute top-0 right-0 -mr-20 -mt-20 w-72 h-72 rounded-full bg-white/10 blur-3xl"></div>
            <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-56 h-56 rounded-full bg-black/10 blur-2xl"></div>

            <div className="relative z-10 w-full flex-1 flex flex-col">
              <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-8 shadow-inner border border-white/20 lg:mx-0 mx-auto">
                <ShieldCheck className="w-8 h-8 text-white" />
              </div>
              
              <h1 className="text-4xl lg:text-5xl font-bold text-white mb-4 tracking-tight">Admin Portal</h1>
              <p className="text-violet-100 text-lg mb-12 font-light leading-relaxed">
                Secure access to institutional management and attendance records.
              </p>
              
              <div className="mt-auto pt-8 border-t border-white/20 w-full space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-4 text-white">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/10">
                      <span className="font-semibold text-sm">1</span>
                    </div>
                    <p className="text-sm text-violet-50 font-medium">Enter your registered email</p>
                  </div>
                  <div className="flex items-center gap-4 text-white">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/10">
                      <span className="font-semibold text-sm">2</span>
                    </div>
                    <p className="text-sm text-violet-50 font-medium">Provide your secure password</p>
                  </div>
                  <div className="flex items-center gap-4 text-white">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/10">
                      <span className="font-semibold text-sm">3</span>
                    </div>
                    <p className="text-sm text-violet-50 font-medium">Access administrative console</p>
                  </div>
                </div>

                <div className="pt-8">
                  <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-violet-100 hover:text-white transition-colors group">
                    <span className="group-hover:-translate-x-1 transition-transform">←</span> Return to Main Menu
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel - Login Form */}
          <div className="w-full lg:w-7/12 p-8 lg:p-12 bg-white flex flex-col justify-center min-h-[500px]">
            <div className="w-full max-w-md mx-auto">
              
              {/* Header */}
              <div className="mb-8">
                <h2 className="text-3xl font-bold text-slate-900 mb-2">Welcome Back</h2>
                <p className="text-slate-600 font-light">Sign in to your administrator account</p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="flex items-center gap-3 p-4 mb-6 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700 shadow-sm">
                  <AlertCircle className="w-5 h-5 shrink-0 flex-none" />
                  <span className="font-medium">{error}</span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-6">
                
                {/* Email Field */}
                <div className="space-y-3">
                  <label htmlFor="email" className="block text-sm font-semibold text-slate-900">
                    Email Address
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                      <Mail className="w-5 h-5 text-slate-400 group-focus-within:text-violet-500 transition-colors" />
                    </div>
                    <input
                      id="email"
                      type="email"
                      placeholder="admin@university.edu"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all bg-slate-50/50 hover:bg-slate-50"
                      required
                      autoComplete="email"
                      disabled={isLoading}
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-3">
                  <label htmlFor="password" className="block text-sm font-semibold text-slate-900">
                    Password
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                      <Lock className="w-5 h-5 text-slate-400 group-focus-within:text-violet-500 transition-colors" />
                    </div>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-12 pr-12 py-3 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all bg-slate-50/50 hover:bg-slate-50"
                      required
                      autoComplete="current-password"
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isLoading}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <EyeOff className="w-5 h-5" />
                      ) : (
                        <Eye className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Forgot Password Link */}
                <div className="flex justify-end">
                  <Link 
                    href="/admin/forgot-password" 
                    className="text-sm font-medium text-violet-600 hover:text-violet-700 transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full group relative overflow-hidden bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:from-slate-400 disabled:to-slate-400 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg hover:shadow-xl active:scale-95 duration-200"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign In</span>
                      <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>

                {/* Footer Links */}
                <div className="text-center text-sm text-slate-600 pt-4">
                  <Link href="/" className="text-violet-600 hover:text-violet-700 font-medium transition-colors">
                    ← Back to main portal
                  </Link>
                </div>
              </form>

              {/* Help Text */}
              <div className="mt-8 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-xs text-slate-600 font-medium mb-2">Demo Credentials:</p>
                <code className="text-xs bg-white px-3 py-2 rounded border border-slate-200 text-slate-700 block font-mono">
                  admin@university.edu
                </code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

