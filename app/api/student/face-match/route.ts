import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function POST(request: NextRequest) {
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Supabase configuration missing' },
        { status: 500 }
      )
    }

    const { faceDescriptor, studentId } = await request.json()

    if (!faceDescriptor || !studentId) {
      return NextResponse.json(
        { success: false, error: 'Face descriptor and student ID required' },
        { status: 400 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get the registered face descriptor for this student
    const { data, error } = await supabase
      .from('student_face_registrations')
      .select('face_descriptor')
      .eq('student_id', studentId)
      .single()

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: 'Student face registration not found' },
        { status: 404 }
      )
    }

    const registeredDescriptor = data.face_descriptor

    if (!registeredDescriptor || !Array.isArray(registeredDescriptor)) {
      return NextResponse.json(
        { success: false, error: 'Invalid registered face descriptor' },
        { status: 400 }
      )
    }

    // Calculate Euclidean distance between descriptors
    const distance = calculateEuclideanDistance(
      new Float32Array(faceDescriptor),
      new Float32Array(registeredDescriptor)
    )

    // Threshold for face matching (typically 0.6 is a good threshold)
    const MATCH_THRESHOLD = 0.6
    const isMatched = distance < MATCH_THRESHOLD

    return NextResponse.json({
      success: true,
      identified: isMatched,
      confidence: isMatched ? 1 - distance : 0,
      distance: distance
    })
  } catch (error) {
    console.error('Face matching error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

function calculateEuclideanDistance(
  descriptor1: Float32Array,
  descriptor2: Float32Array
): number {
  let sum = 0
  for (let i = 0; i < descriptor1.length; i++) {
    const diff = descriptor1[i] - descriptor2[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}
