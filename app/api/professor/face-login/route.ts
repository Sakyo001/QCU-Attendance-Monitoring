import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { getOfflineProfessors, upsertOfflineProfessor } from '@/app/api/_utils/offline-kiosk-cache'

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

    let professors: any[] = []
    let usingOfflineCache = false

    try {
      const supabase = getSupabaseAdmin()
      const { data, error: fetchError } = await supabase
        .from('professor_face_registrations')
        .select('id, professor_id, first_name, last_name, face_descriptor, is_active')
        .eq('is_active', true)

      if (fetchError) {
        throw fetchError
      }

      professors = data || []
      console.log('📊 Found', professors.length, 'registered professors with face data (online)')
    } catch (fetchError) {
      console.warn('⚠️ Supabase unavailable, using offline professor cache:', fetchError)
      usingOfflineCache = true
      professors = (await getOfflineProfessors()).map((p) => ({
        professor_id: p.id,
        first_name: p.firstName,
        last_name: p.lastName,
        face_descriptor: p.faceDescriptor,
        is_active: p.isActive,
      }))
      console.log('📦 Loaded', professors.length, 'professors from offline cache')
    }

    if (professors.length === 0) {
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
      let professorResponse: {
        id: string
        firstName: string
        lastName: string
        email: string
        role: string
        employeeId: string
      } | null = null

      if (!usingOfflineCache) {
        // Get full professor data from users table
        const supabase = getSupabaseAdmin()
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

        professorResponse = {
          id: userData.id,
          firstName: userData.first_name,
          lastName: userData.last_name,
          email: userData.email,
          role: userData.role,
          employeeId: userData.employee_id
        }

        // Save to offline cache for kiosk Step 1 fallback.
        const storedDescriptor = Array.isArray(bestMatch.face_descriptor)
          ? bestMatch.face_descriptor
          : Object.values(bestMatch.face_descriptor as Record<string, number>)

        await upsertOfflineProfessor({
          id: userData.id,
          firstName: userData.first_name,
          lastName: userData.last_name,
          email: userData.email,
          role: userData.role,
          employeeId: userData.employee_id,
          faceDescriptor: storedDescriptor.map((value: any) => Number(value)),
          isActive: true,
        })
      } else {
        const fallbackRole = bestMatch.role || 'professor'
        professorResponse = {
          id: bestMatch.professor_id,
          firstName: bestMatch.first_name,
          lastName: bestMatch.last_name,
          email: bestMatch.email || `${bestMatch.first_name.toLowerCase()}.${bestMatch.last_name.toLowerCase()}@offline.local`,
          role: fallbackRole,
          employeeId: bestMatch.employee_id || ''
        }

        if (fallbackRole !== 'professor' && fallbackRole !== 'adviser') {
          return NextResponse.json({
            error: 'Access denied. Faculty credentials required.',
            matched: false
          }, { status: 403 })
        }
      }

      console.log(`✅ Professor matched: ${bestMatch.first_name} ${bestMatch.last_name} (${(bestSimilarity * 100).toFixed(1)}%)`)

      return NextResponse.json({
        success: true,
        matched: true,
        confidence: bestSimilarity,
        professor: professorResponse
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
