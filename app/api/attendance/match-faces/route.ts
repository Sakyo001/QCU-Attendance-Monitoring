import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { getOfflineStudentsWithFaceDescriptors } from '@/app/api/_utils/offline-kiosk-cache'

/**
 * Batch face matching — accepts multiple face embeddings from a single frame
 * and matches each against enrolled students in a section.
 *
 * POST /api/attendance/match-faces
 * Body: { faces: Array<{ index, embedding }>, sectionId }
 * Returns: { matches: Array<{ faceIndex, matched, student?, confidence? }> }
 */

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0
  let dotProduct = 0, magnitudeA = 0, magnitudeB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    magnitudeA += a[i] * a[i]
    magnitudeB += b[i] * b[i]
  }
  magnitudeA = Math.sqrt(magnitudeA)
  magnitudeB = Math.sqrt(magnitudeB)
  if (magnitudeA === 0 || magnitudeB === 0) return 0
  return dotProduct / (magnitudeA * magnitudeB)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    const { faces, sectionId } = body

    if (!faces || !Array.isArray(faces) || faces.length === 0) {
      return NextResponse.json({
        error: 'faces array is required',
        matches: []
      }, { status: 400 })
    }

    console.log(`🔍 Batch face matching: ${faces.length} face(s), section=${sectionId || 'ALL'}`)

    // Try to fetch from Supabase first
    let students: any[] = []
    let usingOfflineCache = false

    try {
      // Fetch all registered students in this section
      let query = supabase
        .from('student_face_registrations')
        .select('id, student_number, first_name, last_name, face_descriptor, is_active, section_id')
        .eq('is_active', true)

      if (sectionId) {
        query = query.eq('section_id', sectionId)
      }

      const { data: supabaseStudents, error: fetchError } = await query

      if (fetchError) {
        throw fetchError
      }

      students = supabaseStudents || []
      
      if (students.length === 0) {
        throw new Error('Supabase returned no students')
      }

      console.log('✅ Fetched', students.length, 'students from Supabase for face matching')
    } catch (dbError) {
      // Fallback to offline cache
      console.warn('⚠️ Supabase unavailable, using offline student cache for face matching:', dbError)
      usingOfflineCache = true

      try {
        const offlineStudents = await getOfflineStudentsWithFaceDescriptors(sectionId)
        
        if (offlineStudents.length === 0) {
          return NextResponse.json({
            error: 'No registered student faces found in offline cache',
            matches: faces.map((f: any) => ({
              faceIndex: f.index,
              matched: false,
              error: 'No registered faces available'
            })),
            usingOfflineCache: true
          })
        }

        // Transform offline students to match Supabase format
        students = offlineStudents.map((s) => ({
          id: s.id,
          student_number: s.studentNumber,
          first_name: s.firstName,
          last_name: s.lastName,
          face_descriptor: s.faceDescriptor,
          is_active: s.isActive,
          section_id: s.sectionId
        }))

        console.log('📦 Loaded', students.length, 'students from offline cache for face matching')
      } catch (cacheError) {
        console.error('❌ Error loading offline cache:', cacheError)
        return NextResponse.json({
          error: 'No online or offline student data available',
          matches: faces.map((f: any) => ({
            faceIndex: f.index,
            matched: false,
            error: 'No student data available'
          }))
        })
      }
    }

    if (!students || students.length === 0) {
      return NextResponse.json({
        error: 'No registered student faces found',
        matches: faces.map((f: any) => ({
          faceIndex: f.index,
          matched: false,
          error: 'No registered faces in section'
        })),
        usingOfflineCache
      })
    }

    // Pre-process stored descriptors once (avoid re-parsing for each input face)
    const processedStudents = students.map((student: any) => {
      let storedDescriptor = student.face_descriptor
      if (!storedDescriptor) return null

      if (typeof storedDescriptor === 'object' && !Array.isArray(storedDescriptor)) {
        storedDescriptor = Object.values(storedDescriptor as Record<string, number>)
      }

      const storedArray: number[] = Array.isArray(storedDescriptor)
        ? storedDescriptor
        : Object.values(storedDescriptor)

      return { ...student, descriptorArray: storedArray }
    }).filter(Boolean) as Array<any>

    const SIMILARITY_THRESHOLD = 0.70
    const matchedStudentIds = new Set<string>() // prevent same student matched twice
    const matches: any[] = []

    for (const face of faces) {
      const inputDescriptor: number[] = Array.isArray(face.embedding)
        ? face.embedding
        : Object.values(face.embedding as Record<string, number>)

      let bestMatch: any = null
      let bestSimilarity = -1

      for (const student of processedStudents) {
        // Skip students already matched to another face in this batch
        if (matchedStudentIds.has(student.id)) continue

        try {
          const similarity = cosineSimilarity(inputDescriptor, student.descriptorArray)
          if (similarity > bestSimilarity) {
            bestSimilarity = similarity
            bestMatch = student
          }
        } catch {
          continue
        }
      }

      if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
        matchedStudentIds.add(bestMatch.id)
        console.log(`  ✅ Face #${face.index}: ${bestMatch.first_name} ${bestMatch.last_name} (${bestSimilarity.toFixed(4)})`)
        matches.push({
          faceIndex: face.index,
          matched: true,
          student: {
            id: bestMatch.id,
            first_name: bestMatch.first_name,
            last_name: bestMatch.last_name,
            student_number: bestMatch.student_number
          },
          confidence: bestSimilarity
        })
      } else {
        console.log(`  ❌ Face #${face.index}: no match (best=${bestSimilarity.toFixed(4)})`)
        matches.push({
          faceIndex: face.index,
          matched: false,
          confidence: bestSimilarity > 0 ? bestSimilarity : undefined
        })
      }
    }

    return NextResponse.json({
      success: true,
      matches,
      totalFaces: faces.length,
      totalMatched: matches.filter((m: any) => m.matched).length
    })
  } catch (error) {
    console.error('❌ Batch face matching error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      matches: []
    }, { status: 500 })
  }
}
