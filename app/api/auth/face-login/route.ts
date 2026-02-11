import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'

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

    // Check professors first
    const { data: professors, error: professorError } = await supabase
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

    console.log('Professors query result:', { count: professors?.length, error: professorError })
    if (professors && professors.length > 0) {
      console.log('Sample professor record:', JSON.stringify(professors[0], null, 2))
    }

    if (professorError) {
      console.error('Error fetching professors:', professorError)
      return NextResponse.json(
        { error: 'Failed to fetch professor face registrations' },
        { status: 500 }
      )
    }

    // Check students
    const { data: students, error: studentError } = await supabase
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
      console.error('Error fetching students:', studentError)
      return NextResponse.json(
        { error: 'Failed to fetch student face registrations' },
        { status: 500 }
      )
    }

    let bestMatch: any = null
    let bestSimilarity = 0
    const threshold = 0.7 // 70% match required

    // Compare with professors
    if (professors && professors.length > 0) {
      for (const prof of professors) {
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
    if (students && students.length > 0) {
      for (const student of students) {
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
      return NextResponse.json({
        matched: true,
        user: {
          id: bestMatch.user.id,
          firstName: bestMatch.user.first_name,
          lastName: bestMatch.user.last_name,
          email: bestMatch.user.email,
          role: bestMatch.user.role,
          studentId: bestMatch.user.student_id,
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
