import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Euclidean distance calculation
function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { faceDescriptor, sessionId } = body

    if (!faceDescriptor || !sessionId) {
      return NextResponse.json({ 
        error: 'Face descriptor and session ID are required' 
      }, { status: 400 })
    }

    // Get all students with face descriptors
    const { data: facialData, error: fetchError } = await supabase
      .from('facial_recognition_data')
      .select('user_id, face_encoding, is_active')
      .eq('is_active', true)

    if (fetchError) {
      console.error('Error fetching face data:', fetchError)
      return NextResponse.json({ 
        error: 'Failed to fetch face data' 
      }, { status: 400 })
    }

    if (!facialData || facialData.length === 0) {
      return NextResponse.json({ 
        error: 'No registered faces found',
        matched: false
      }, { status: 404 })
    }

    // Convert input descriptor to array
    const inputDescriptor = Array.isArray(faceDescriptor) 
      ? faceDescriptor 
      : Object.values(faceDescriptor as Record<string, number>)

    // Find best matching face
    let bestMatch = null
    let bestDistance = Infinity
    const DISTANCE_THRESHOLD = 0.6

    for (const faceRecord of facialData) {
      try {
        // Parse the stored face encoding
        const storedDescriptor = JSON.parse(Buffer.from(faceRecord.face_encoding, 'base64').toString('utf-8'))
        const distance = euclideanDistance(inputDescriptor, storedDescriptor)

        if (distance < bestDistance) {
          bestDistance = distance
          bestMatch = faceRecord
        }
      } catch (e) {
        console.error('Error parsing face encoding:', e)
        continue
      }
    }

    // Check if match is good enough
    if (bestMatch && bestDistance < DISTANCE_THRESHOLD) {
      // Get student info
      const { data: student, error: studentError } = await supabase
        .from('users')
        .select('id, first_name, last_name, student_id')
        .eq('id', bestMatch.user_id)
        .single()

      if (studentError || !student) {
        return NextResponse.json({ 
          error: 'Student not found' 
        }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        matched: true,
        student: {
          id: student.id,
          firstName: student.first_name,
          lastName: student.last_name,
          studentId: student.student_id
        },
        confidence: 1 - (bestDistance / DISTANCE_THRESHOLD)
      })
    }

    return NextResponse.json({
      success: false,
      matched: false,
      error: 'Face not recognized',
      distance: bestDistance
    }, { status: 404 })

  } catch (error) {
    console.error('Face match error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
