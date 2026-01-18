import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const professorId = searchParams.get('professorId')

    if (!professorId) {
      return NextResponse.json(
        { error: 'Professor ID is required' },
        { status: 400 }
      )
    }

    // Use service role key to bypass RLS
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check if professor has registered facial recognition
    // Look for any registration record regardless of is_active status
    const { data, error } = await supabase
      .from('professor_face_registrations')
      .select('id, first_name, last_name, image_url, is_active')
      .eq('professor_id', professorId)
      .single()

    if (error) {
      // PGRST116 = no rows found (not an error, just means not registered)
      if (error.code !== 'PGRST116') {
        console.error('Error checking face registration:', error)
      }
      
      return NextResponse.json({
        success: true,
        isRegistered: false,
        registration: null
      })
    }

    // Return true if any registration exists
    return NextResponse.json({
      success: true,
      isRegistered: !!data,
      registration: data || null
    })

  } catch (error: any) {
    console.error('Exception in face registration check:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
