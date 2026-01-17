import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    
    // Get all sections
    const { data: sections, error } = await supabase
      .from('sections')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('Error fetching sections:', error)
      return NextResponse.json(
        { error: error.message, details: error },
        { status: 500 }
      )
    }
    
    return NextResponse.json({
      success: true,
      count: sections?.length || 0,
      sections: sections || []
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Unexpected error', details: error.message },
      { status: 500 }
    )
  }
}
