import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

// Cosine similarity calculation (matching the student face matching API)
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

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()
    const { professorId, faceDescriptor } = body

    if (!professorId || !faceDescriptor) {
      return NextResponse.json(
        { success: false, message: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Fetch professor's registered face descriptor
    const { data: registration, error: registrationError } = await supabase
      .from('professor_face_registrations')
      .select('face_descriptor, first_name, last_name')
      .eq('professor_id', professorId)
      .eq('is_active', true)
      .single()

    if (registrationError || !registration) {
      console.error('Face registration not found:', registrationError)
      return NextResponse.json(
        { success: false, verified: false, message: 'Face registration not found' },
        { status: 404 }
      )
    }

    // Parse stored descriptor
    // face_descriptor is stored as JSONB, so it may already be an object
    let storedDescriptor = registration.face_descriptor
    if (typeof storedDescriptor === 'string') {
      storedDescriptor = JSON.parse(storedDescriptor)
    }

    if (!storedDescriptor) {
      return NextResponse.json(
        { success: false, verified: false, message: 'No face descriptor on file' },
        { status: 400 }
      )
    }

    // Convert both descriptors to arrays
    const inputArray = Array.isArray(faceDescriptor) 
      ? faceDescriptor 
      : Object.values(faceDescriptor as Record<string, number>)

    const storedArray = Array.isArray(storedDescriptor)
      ? storedDescriptor
      : Object.values(storedDescriptor as Record<string, number>)

    // Validate descriptor lengths (FaceNet uses 128-dimensional embeddings)
    if (inputArray.length !== 128 || storedArray.length !== 128) {
      console.error(`❌ Invalid descriptor length: input=${inputArray.length}, stored=${storedArray.length}, expected=128`)
      return NextResponse.json(
        { success: false, verified: false, message: 'Invalid face descriptor format' },
        { status: 400 }
      )
    }

    // Calculate similarity using cosine similarity
    const similarity = cosineSimilarity(inputArray, storedArray)
    
    // Threshold for FaceNet embeddings - requires 60% similarity
    // FaceNet embeddings are more discriminative than raw landmarks
    // Lower threshold (0.6) is acceptable because embeddings capture unique identity features
    const SIMILARITY_THRESHOLD = 0.6
    const verified = similarity >= SIMILARITY_THRESHOLD

    console.log(`🔐 Face verification for professor ${professorId}:`)
    console.log(`   - Similarity: ${similarity.toFixed(4)} (${(similarity * 100).toFixed(2)}%)`)
    console.log(`   - Threshold: ${SIMILARITY_THRESHOLD} (${(SIMILARITY_THRESHOLD * 100).toFixed(0)}%)`)
    console.log(`   - Verified: ${verified ? '✅ YES' : '❌ NO'}`)
    console.log(`   - Input descriptor sample: [${inputArray.slice(0, 5).map(n => n.toFixed(3)).join(', ')}...]`)
    console.log(`   - Stored descriptor sample: [${storedArray.slice(0, 5).map(n => n.toFixed(3)).join(', ')}...]`)
    
    // Additional check: if similarity is too high (>0.98), might be the exact same image
    if (similarity > 0.98) {
      console.warn(`⚠️ Very high similarity detected (${similarity.toFixed(4)}) - possible photo reuse`)
    }

    if (verified) {
      return NextResponse.json({
        success: true,
        verified: true,
        message: `Welcome back, ${registration.first_name}!`,
        similarity
      })
    } else {
      return NextResponse.json({
        success: true,
        verified: false,
        message: 'Face does not match registration. Please try again.',
        similarity
      })
    }
  } catch (error: any) {
    console.error('Face verification error:', error)
    return NextResponse.json(
      { success: false, verified: false, message: 'Verification error occurred' },
      { status: 500 }
    )
  }
}
