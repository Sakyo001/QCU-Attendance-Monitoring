import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

/**
 * GET /api/attendance/section-encodings?sectionId=xxx
 *
 * Returns all enrolled students with their face descriptors for a section.
 * Used to pre-load the Python server's session cache for real-time recognition.
 */
export async function GET(request: NextRequest) {
  try {
    const sectionId = request.nextUrl.searchParams.get('sectionId')

    if (!sectionId) {
      return NextResponse.json(
        { success: false, error: 'sectionId is required' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()

    const { data: students, error } = await supabase
      .from('student_face_registrations')
      .select('id, student_number, first_name, last_name, face_descriptor, section_id')
      .eq('section_id', sectionId)
      .eq('is_active', true)

    if (error) {
      console.error('❌ Error fetching section encodings:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch face data' },
        { status: 500 }
      )
    }

    const result = (students || [])
      .filter((s: any) => s.face_descriptor)
      .map((s: any) => {
        let embedding = s.face_descriptor
        // Handle object format (keys are indices) → convert to array
        if (typeof embedding === 'object' && !Array.isArray(embedding)) {
          embedding = Object.values(embedding)
        }
        return {
          id: s.id,
          name: `${s.first_name} ${s.last_name}`,
          student_number: s.student_number,
          embedding,
        }
      })

    console.log(`📚 Section ${sectionId}: ${result.length} students with face data`)

    return NextResponse.json({
      success: true,
      students: result,
      count: result.length,
    })
  } catch (error) {
    console.error('❌ Section encodings error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
