import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

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

    console.log('🔍 Professor face login request received:', {
      hasFaceDescriptor: !!faceDescriptor,
      descriptorLength: Array.isArray(faceDescriptor) ? faceDescriptor.length : 'N/A'
    })

    if (!faceDescriptor) {
      return NextResponse.json({ 
        error: 'Face descriptor is required',
        matched: false
      }, { status: 400 })
    }

    // Get all professors with face descriptors
    const { data: professors, error: fetchError } = await supabase
      .from('professor_face_registrations')
      .select('id, professor_id, first_name, last_name, face_descriptor, is_active')
      .eq('is_active', true)

    if (fetchError) {
      console.error('❌ Error fetching professor face data:', fetchError)
      return NextResponse.json({ 
        error: 'Failed to fetch professor face data',
        matched: false
      }, { status: 400 })
    }

    console.log('📊 Found', professors?.length || 0, 'registered professors with face data')

    if (!professors || professors.length === 0) {
      return NextResponse.json({ 
        error: 'No registered professor faces found',
        matched: false
      }, { status: 404 })
    }

    // Convert input descriptor to array
    const inputDescriptor = Array.isArray(faceDescriptor) 
      ? faceDescriptor 
      : Object.values(faceDescriptor as Record<string, number>)

    // Find best matching face using cosine similarity
    let bestMatch = null
    let bestSimilarity = -1
    const SIMILARITY_THRESHOLD = 0.7 // 70% match required

    for (const professor of professors) {
      try {
        const storedDescriptor = professor.face_descriptor
        if (!storedDescriptor) continue

        const storedArray = Array.isArray(storedDescriptor) 
          ? storedDescriptor 
          : Object.values(storedDescriptor as Record<string, number>)

        if (storedArray.length !== inputDescriptor.length) {
          console.warn(`⚠️ Descriptor length mismatch for professor ${professor.professor_id}`)
          continue
        }

        const similarity = cosineSimilarity(inputDescriptor, storedArray)
        
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity
          bestMatch = professor
        }
      } catch (error) {
        console.error('Error comparing with professor:', professor.professor_id, error)
      }
    }

    if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
      // Get full professor data from users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', bestMatch.professor_id)
        .single()

      if (userError || !userData) {
        return NextResponse.json({ 
          error: 'Professor user record not found',
          matched: false
        }, { status: 404 })
      }

      // Check if the user is actually a professor
      if (userData.role !== 'professor' && userData.role !== 'adviser') {
        return NextResponse.json({ 
          error: 'Access denied. Faculty credentials required.',
          matched: false
        }, { status: 403 })
      }

      console.log(`✅ Professor matched: ${bestMatch.first_name} ${bestMatch.last_name} (${(bestSimilarity * 100).toFixed(1)}%)`)

      return NextResponse.json({
        success: true,
        matched: true,
        confidence: bestSimilarity,
        professor: {
          id: userData.id,
          firstName: userData.first_name,
          lastName: userData.last_name,
          email: userData.email,
          role: userData.role,
          employeeId: userData.employee_id
        }
      })
    }

    console.log('❌ No matching professor found. Best similarity:', (bestSimilarity * 100).toFixed(1) + '%')
    
    return NextResponse.json({
      success: false,
      matched: false,
      confidence: bestSimilarity,
      error: 'Face not recognized. Please try again or contact administrator.'
    })

  } catch (error: any) {
    console.error('❌ Professor face login error:', error)
    return NextResponse.json({ 
      error: error.message || 'Internal server error',
      matched: false
    }, { status: 500 })
  }
}
