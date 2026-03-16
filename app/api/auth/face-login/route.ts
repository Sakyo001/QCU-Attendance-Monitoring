import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'
import { getOfflineProfessors, getOfflineStudentsBySection, upsertOfflineProfessor } from '@/app/api/_utils/offline-kiosk-cache'

// Helper function to calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    console.warn('Vector length mismatch:', a.length, 'vs', b.length)
    return 0
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  if (magnitude === 0) return 0

  return dotProduct / magnitude
}

export async function POST(request: NextRequest) {
  try {
    const { faceDescriptor } = await request.json()

    if (!faceDescriptor || !Array.isArray(faceDescriptor)) {
      return NextResponse.json(
        { error: 'Face descriptor is required and must be an array' },
        { status: 400 }
      )
    }

    const supabase = createServiceRoleClient()

    let professors: any[] = []
    let students: any[] = []
    let usingOfflineCache = false

    // Try to fetch from Supabase first
    try {
      // Check professors
      const { data: dbProfessors, error: professorError } = await supabase
        .from('professor_face_registrations')
        .select(`
          professor_id,
          face_descriptor,
          users!professor_face_registrations_professor_id_fkey (
            id,
            first_name,
            last_name,
            email,
            role,
            employee_id
          )
        `)
        .eq('is_active', true)

      console.log('Professors query result:', { count: dbProfessors?.length, error: professorError })

      if (professorError) {
        throw professorError
      }

      if (dbProfessors && dbProfessors.length > 0) {
        console.log('Sample professor record:', JSON.stringify(dbProfessors[0], null, 2))
      }
      professors = dbProfessors || []

      // Check students
      const { data: dbStudents, error: studentError } = await supabase
        .from('student_face_registrations')
        .select(`
          student_id,
          face_descriptor,
          users!student_face_registrations_student_id_fkey (
            id,
            first_name,
            last_name,
            email,
            role,
            student_id
          )
        `)
        .eq('is_active', true)

      if (studentError) {
        throw studentError
      }
      students = dbStudents || []
    } catch (fetchError) {
      console.warn('⚠️ Supabase unavailable, using offline cache:', fetchError)
      usingOfflineCache = true

      // Load from offline cache
      const offlineProfessors = await getOfflineProfessors()
      professors = offlineProfessors.map((p) => ({
        professor_id: p.id,
        face_descriptor: p.faceDescriptor,
        users: {
          id: p.id,
          first_name: p.firstName,
          last_name: p.lastName,
          email: p.email,
          role: p.role,
          employee_id: p.employeeId
        }
      }))

      // Note: For students, we need to load from all sections since we don't know which section the user is in
      // So we'll skip offline students for now, or try to get all students from cache
      // The offline cache structure doesn't have a function to get all students
      console.log('📦 Loaded', professors.length, 'professors from offline cache')
    }

    let bestMatch: any = null
    let bestSimilarity = 0
    const threshold = 0.7 // 70% match required

    // Compare with professors
    if (professors && (professors as any[]).length > 0) {
      for (const prof of ((professors as any[]) || [])) {
        if (!prof.face_descriptor) {
          continue
        }
        
        if (!prof.users) {
          // Try to manually fetch the user as a fallback
          const { data: manualUser, error: manualError } = await supabase
            .from('users')
            .select('id, first_name, last_name, email, role, employee_id')
            .eq('id', prof.professor_id)
            .single()
          
          if (manualError || !manualUser) {
            continue
          }
          
          // Use the manually fetched user data
          prof.users = manualUser
        }
        
        if (Array.isArray(prof.users)) {
          continue
        }

        const storedDescriptor = prof.face_descriptor as number[]
        const similarity = cosineSimilarity(faceDescriptor, storedDescriptor)

        if (similarity > bestSimilarity && similarity >= threshold) {
          bestSimilarity = similarity
          bestMatch = {
            type: 'professor',
            user: prof.users
          }
        }
      }
    }

    // Compare with students
    if (students && (students as any[]).length > 0) {
      for (const student of ((students as any[]) || [])) {
        if (!student.face_descriptor) {
          continue
        }
        
        if (!student.users) {
          // Try to manually fetch the user as a fallback
          const { data: manualUser, error: manualError } = await supabase
            .from('users')
            .select('id, first_name, last_name, email, role, student_id')
            .eq('id', student.student_id)
            .single()
          
          if (manualError || !manualUser) {
            continue
          }
          
          // Use the manually fetched user data
          student.users = manualUser
        }
        
        if (Array.isArray(student.users)) {
          continue
        }

        const storedDescriptor = student.face_descriptor as number[]
        const similarity = cosineSimilarity(faceDescriptor, storedDescriptor)

        if (similarity > bestSimilarity && similarity >= threshold) {
          bestSimilarity = similarity
          bestMatch = {
            type: 'student',
            user: student.users
          }
        }
      }
    }

    if (bestMatch) {
      // Cache professor with face descriptor for offline use if we got this from Supabase
      if (!usingOfflineCache && bestMatch.type === 'professor') {
        try {
          const profData = bestMatch.user
          await upsertOfflineProfessor({
            id: profData.id,
            firstName: profData.first_name,
            lastName: profData.last_name,
            email: profData.email,
            role: profData.role,
            employeeId: profData.employee_id,
            faceDescriptor: faceDescriptor,
            isActive: true
          })
          console.log(`📦 Cached professor ${profData.first_name} ${profData.last_name} with face data`)
        } catch (cacheErr) {
          console.warn('Failed to cache professor:', cacheErr)
        }
      }

      return NextResponse.json({
        matched: true,
        professor: {
          id: bestMatch.user.id,
          firstName: bestMatch.user.first_name,
          lastName: bestMatch.user.last_name,
          email: bestMatch.user.email,
          role: bestMatch.user.role,
          employeeId: bestMatch.user.employee_id
        },
        similarity: bestSimilarity
      })
    }

    console.log('No match found above threshold')
    return NextResponse.json({
      matched: false,
      message: 'No matching face found'
    })

  } catch (error) {
    console.error('Face login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
