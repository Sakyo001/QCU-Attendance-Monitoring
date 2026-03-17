import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { getOfflineStudentsBySection, upsertOfflineStudents } from '@/app/api/_utils/offline-kiosk-cache'

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

    let result: any[] = []
    let source: 'supabase' | 'offline-cache' = 'supabase'

    try {
      const supabase = getSupabaseAdmin()

      const { data: students, error } = await supabase
        .from('student_face_registrations')
        .select('id, student_number, first_name, last_name, face_descriptor, section_id, is_active')
        .eq('section_id', sectionId)
        .eq('is_active', true)

      if (error) {
        throw error
      }

      const normalized = (students || []).map((s: any) => {
        let embedding = s.face_descriptor
        // Handle object format (keys are indices) → convert to array
        if (embedding && typeof embedding === 'object' && !Array.isArray(embedding)) {
          embedding = Object.values(embedding)
        }

        const normalizedEmbedding = Array.isArray(embedding)
          ? embedding.map((value: any) => Number(value))
          : undefined

        return {
          id: String(s.id),
          student_number: String(s.student_number || ''),
          first_name: String(s.first_name || ''),
          last_name: String(s.last_name || ''),
          section_id: String(s.section_id || sectionId),
          face_descriptor: normalizedEmbedding,
          is_active: s.is_active !== false,
        }
      })

      result = normalized
        .filter((s: any) => Array.isArray(s.face_descriptor) && s.face_descriptor.length > 0)
        .map((s: any) => ({
          id: s.id,
          name: `${s.first_name} ${s.last_name}`.trim(),
          student_number: s.student_number,
          embedding: s.face_descriptor,
        }))

      console.log(`📚 [section-encodings] Supabase query returned ${normalized.length} total students`)
      console.log(`📚 [section-encodings] After filtering valid embeddings: ${result.length} students with face data`)
      if (result.length === 0 && normalized.length > 0) {
        console.warn(`⚠️  [section-encodings] All ${normalized.length} students are missing embeddings!`)
        console.warn(`    Sample student:`, JSON.stringify(normalized[0], null, 2))
      }

      // Always update offline cache with fresh online data to keep it in sync
      try {
        await upsertOfflineStudents(
          normalized.map((s: any) => ({
            id: s.id,
            studentNumber: s.student_number,
            firstName: s.first_name,
            lastName: s.last_name,
            sectionId: s.section_id,
            faceDescriptor: s.face_descriptor,
            isActive: s.is_active,
          }))
        )
        console.log(`✅ [section-encodings] Updated offline cache with ${normalized.length} students`)
      } catch (syncErr) {
        console.warn('⚠️ Failed to sync online data to offline cache:', syncErr)
      }
    } catch (error) {
      console.warn('⚠️ Failed to fetch section encodings from Supabase, falling back to offline cache:', error)
      source = 'offline-cache'
      const cachedStudents = await getOfflineStudentsBySection(sectionId)
      result = cachedStudents
        .filter((s) => Array.isArray(s.faceDescriptor) && s.faceDescriptor.length > 0)
        .map((s) => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`.trim(),
          student_number: s.studentNumber,
          embedding: s.faceDescriptor,
        }))
      
      console.log(`📦 [section-encodings] Using offline cache: ${result.length} students`)
    }

    console.log(`📚 Section ${sectionId}: ${result.length} students with face data`)

    return NextResponse.json({
      success: true,
      students: result,
      count: result.length,
      source,
    })
  } catch (error) {
    console.error('❌ Section encodings error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
