import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

// Euclidean distance calculation
function euclideanDistance(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) {
    return Infinity
  }
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

// Cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) {
    return 0
  }
  let dotProduct = 0
  let magnitudeA = 0
  let magnitudeB = 0
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    magnitudeA += a[i] * a[i]
    magnitudeB += b[i] * b[i]
  }
  
  magnitudeA = Math.sqrt(magnitudeA)
  magnitudeB = Math.sqrt(magnitudeB)
  
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0
  }
  
  return dotProduct / (magnitudeA * magnitudeB)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    const { faceDescriptor } = body

    console.log('🔍 Face matching request received:', {
      hasFaceDescriptor: !!faceDescriptor,
      descriptorType: typeof faceDescriptor,
      descriptorIsArray: Array.isArray(faceDescriptor),
      descriptorLength: Array.isArray(faceDescriptor) ? faceDescriptor.length : 'N/A',
      format: Array.isArray(faceDescriptor) && faceDescriptor.length === 128 ? 'FaceNet (128D)' : 'Unknown'
    })

    if (!faceDescriptor) {
      return NextResponse.json({ 
        error: 'Face descriptor is required',
        matched: false
      }, { status: 400 })
    }

    // Get all students with face descriptors from student_face_registrations
    const { data: students, error: fetchError } = await supabase
      .from('student_face_registrations')
      .select('id, student_number, first_name, last_name, face_descriptor, is_active')
      .eq('is_active', true)

    if (fetchError) {
      console.error('❌ Error fetching student face data:', fetchError)
      return NextResponse.json({ 
        error: 'Failed to fetch student face data',
        matched: false
      }, { status: 400 })
    }

    console.log('📊 Found', students?.length || 0, 'registered students with face descriptors')

    if (!students || students.length === 0) {
      return NextResponse.json({ 
        error: 'No registered student faces found',
        matched: false
      }, { status: 404 })
    }

    // Convert input descriptor to array
    const inputDescriptor = Array.isArray(faceDescriptor) 
      ? faceDescriptor 
      : Object.values(faceDescriptor as Record<string, number>)

    console.log('📍 Input descriptor length:', inputDescriptor.length)

    // Find best matching face using cosine similarity
    let bestMatch = null
    let bestSimilarity = -1
    // Stricter threshold for better security - prevents photo spoofing
    const SIMILARITY_THRESHOLD = 0.7 // Cosine similarity threshold (70% match required)

    for (const student of students) {
      try {
        // Handle face_descriptor as JSONB (could be object or array)
        let storedDescriptor = student.face_descriptor
        
        if (!storedDescriptor) {
          console.warn(`⚠️ Student ${student.student_number} has no face descriptor`)
          continue
        }

        // Convert to array if it's an object
        if (typeof storedDescriptor === 'object' && !Array.isArray(storedDescriptor)) {
          storedDescriptor = Object.values(storedDescriptor as Record<string, number>)
        }

        const storedArray = Array.isArray(storedDescriptor) 
          ? storedDescriptor 
          : Object.values(storedDescriptor)

        // Calculate similarity
        const similarity = cosineSimilarity(inputDescriptor, storedArray)
        
        console.log(`👤 ${student.first_name} ${student.last_name}: similarity = ${similarity.toFixed(4)}`)

        if (similarity > bestSimilarity) {
          bestSimilarity = similarity
          bestMatch = student
        }
      } catch (e) {
        console.error(`⚠️ Error processing descriptor for student ${student.student_number}:`, e)
        continue
      }
    }

    // Check if match is good enough
    if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
      console.log(`✅ Match found: ${bestMatch.first_name} ${bestMatch.last_name} (similarity: ${bestSimilarity.toFixed(4)})`)
      
      return NextResponse.json({
        success: true,
        matched: true,
        student: {
          id: bestMatch.id,
          first_name: bestMatch.first_name,
          last_name: bestMatch.last_name,
          student_number: bestMatch.student_number
        },
        confidence: bestSimilarity
      })
    }

    console.log(`❌ No match found. Best similarity: ${bestSimilarity.toFixed(4)}, threshold: ${SIMILARITY_THRESHOLD}`)
    
    return NextResponse.json({
      success: true,
      matched: false,
      error: 'Face not recognized',
      debug: {
        bestSimilarity: bestSimilarity.toFixed(4),
        threshold: SIMILARITY_THRESHOLD
      }
    })
  } catch (error) {
    console.error('❌ Face matching error:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      matched: false
    }, { status: 500 })
  }
}
