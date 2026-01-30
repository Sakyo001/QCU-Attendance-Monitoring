import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const searchParams = request.nextUrl.searchParams
    const email = searchParams.get('email')

    if (!email) {
      return NextResponse.json({ error: 'Email parameter required' }, { status: 400 })
    }

    // Check if email exists in users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .limit(1)

    if (userError) {
      console.error('Database query error:', userError)
      return NextResponse.json({ error: 'Failed to check email' }, { status: 500 })
    }

    if (userData && userData.length > 0) {
      return NextResponse.json({ exists: true })
    }

    // Also check if email exists in auth.users table to catch orphaned auth users
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers()

    if (authError) {
      console.error('Auth query error:', authError)
      // Don't fail here, just log it - the app table check is primary
      return NextResponse.json({ exists: userData && userData.length > 0 })
    }

    // Check if email exists in auth users
    const emailExistsInAuth = (authUsers as any).users.some((user: any) => user.email === email)

    return NextResponse.json({ exists: emailExistsInAuth })
  } catch (error) {
    console.error('Check email error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

