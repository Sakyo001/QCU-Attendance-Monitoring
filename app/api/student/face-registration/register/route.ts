import { NextRequest, NextResponse } from 'next/server'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { studentId, faceData, faceDescriptor } = body

    // Validate required fields
    if (!studentId || !faceData) {
      return NextResponse.json(
        { error: 'Student ID and face data are required' },
        { status: 400 }
      )
    }

    // Save image locally
    const imageId = uuidv4()
    const imagesDir = join(process.cwd(), 'public', 'face-registrations')
    mkdirSync(imagesDir, { recursive: true })

    // Convert base64 to buffer and save
    const base64Data = faceData.replace(/^data:image\/\w+;base64,/, '')
    const imageBuffer = Buffer.from(base64Data, 'base64')
    const imageFileName = `student-${studentId}-${imageId}.jpg`
    const imagePath = join(imagesDir, imageFileName)
    writeFileSync(imagePath, imageBuffer)

    // Create image URL (public path)
    const imageUrl = `/face-registrations/${imageFileName}`

    // Create Supabase client with service role
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check if student already has a registration
    const { data: existing, error: checkError } = await supabase
      .from('student_face_registrations')
      .select('id')
      .eq('student_id', studentId)
      .single()

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking existing registration:', checkError)
    }

    if (existing) {
      // Update existing registration
      const { data, error } = await supabase
        .from('student_face_registrations')
        .update({
          face_data: faceData,
          face_descriptor: faceDescriptor || null,
          image_url: imageUrl,
          updated_at: new Date().toISOString()
        })
        .eq('student_id', studentId)
        .select()
        .single()

      if (error) {
        console.error('Error updating face registration:', error)
        return NextResponse.json(
          { error: 'Failed to update facial registration: ' + error.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        message: 'Facial registration updated successfully',
        registration: data
      })
    } else {
      // Create new registration
      const { data, error } = await supabase
        .from('student_face_registrations')
        .insert({
          student_id: studentId,
          face_data: faceData,
          face_descriptor: faceDescriptor || null,
          image_url: imageUrl
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating face registration:', error)
        return NextResponse.json(
          { error: 'Failed to register facial recognition: ' + error.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        message: 'Facial registration completed successfully',
        registration: data
      })
    }
  } catch (error: any) {
    console.error('Face registration error:', error)
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    )
  }
}
