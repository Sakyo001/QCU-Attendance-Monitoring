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

// Calculate descriptor variance to detect static/synthetic faces
function calculateVariance(descriptor: number[]): number {
  const mean = descriptor.reduce((sum, val) => sum + val, 0) / descriptor.length
  const variance = descriptor.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / descriptor.length
  return variance
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

    // Validate descriptor lengths (keras-facenet uses 512 dimensions)
    if (inputArray.length !== 512 || storedArray.length !== 512) {
      console.error(`❌ Invalid descriptor length: input=${inputArray.length}, stored=${storedArray.length}, expected=512`)
      return NextResponse.json(
        { success: false, verified: false, message: 'Invalid face descriptor format' },
        { status: 400 }
      )
    }

    // Anti-spoofing: Check descriptor variance
    // Real faces have natural variance in embeddings
    // Static photos or manipulated data may have abnormal variance
    const inputVariance = calculateVariance(inputArray)
    const storedVariance = calculateVariance(storedArray)
    
    const MIN_VARIANCE = 0.001 // Too low = suspicious (possibly synthetic)
    const MAX_VARIANCE = 10.0  // Too high = suspicious (possibly corrupted)
    
    if (inputVariance < MIN_VARIANCE || inputVariance > MAX_VARIANCE) {
      console.warn(`🚨 SUSPICIOUS: Input descriptor variance out of range: ${inputVariance.toFixed(6)}`)
      return NextResponse.json(
        { success: false, verified: false, message: 'Face verification failed. Please ensure proper lighting and face the camera.' },
        { status: 400 }
      )
    }

    // Calculate similarity using cosine similarity
    const similarity = cosineSimilarity(inputArray, storedArray)
    
    // FaceNet threshold - same as student attendance (70%)
    // FaceNet embeddings are designed for face recognition and are highly discriminative
    // 70% threshold provides excellent accuracy while preventing false positives
    const SIMILARITY_THRESHOLD = 0.70
    const verified = similarity >= SIMILARITY_THRESHOLD

    console.log(`🔐 Face verification for professor ${professorId}:`)
    console.log(`   - Cosine similarity: ${similarity.toFixed(4)} (${(similarity * 100).toFixed(2)}%) [threshold: ${(SIMILARITY_THRESHOLD * 100).toFixed(0)}%]`)
    console.log(`   - VERIFIED: ${verified ? '✅ YES' : '❌ NO'}`)
    console.log(`   - Input variance: ${inputVariance.toFixed(6)}`)
    console.log(`   - Stored variance: ${storedVariance.toFixed(6)}`)
    console.log(`   - Input descriptor sample: [${inputArray.slice(0, 5).map(n => n.toFixed(3)).join(', ')}...]`)
    console.log(`   - Stored descriptor sample: [${storedArray.slice(0, 5).map(n => n.toFixed(3)).join(', ')}...]`)
    
    // Security checks
    if (similarity > 0.98) {
      console.warn(`⚠️ Very high similarity detected (${similarity.toFixed(4)}) - possible photo reuse`)
    }
    
    // Log all failed attempts for security monitoring
    if (!verified) {
      if (similarity < 0.3) {
        console.warn(`🚨 SECURITY ALERT: Very low similarity (${similarity.toFixed(4)}) - completely different person`)
      } else {
        console.warn(`🚨 SECURITY ALERT: Failed verification - similarity: ${similarity.toFixed(4)} (required: ${SIMILARITY_THRESHOLD})`)
      }
    }

    if (verified) {
      return NextResponse.json({
        success: true,
        verified: true,
        message: `Welcome back, ${registration.first_name}!`,
        similarity
      })
    } else {
      // Provide helpful feedback based on similarity
      let message = 'Face does not match registration. Please try again.'
      if (similarity < 0.3) {
        message = 'Face not recognized. Ensure you are the registered professor.'
      } else if (similarity >= 0.5 && similarity < SIMILARITY_THRESHOLD) {
        message = 'Face partially matched. Please ensure good lighting and face the camera directly.'
      }
      
      return NextResponse.json({
        success: true,
        verified: false,
        message,
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
