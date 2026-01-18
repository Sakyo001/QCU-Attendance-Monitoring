import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { firstName, lastName, middleInitial, studentId, email, faceData, faceDescriptor } = body

    if (!firstName || !lastName || !studentId || !email) {
      return NextResponse.json({ error: 'First name, last name, student ID, and email are required' }, { status: 400 })
    }

    const password = 'student123'

    // Create Supabase Auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: {
        firstName,
        lastName,
        middleInitial: middleInitial || '',
        role: 'student'
      }
    })

    if (authError) {
      console.error('Auth error:', authError)
      console.error('Auth error details:', {
        code: authError.code,
        message: authError.message,
        status: authError.status
      })
      return NextResponse.json({ 
        error: 'Failed to create auth user',
        details: authError.message
      }, { status: 400 })
    }

    // Create student record in database
    const { error: insertError } = await supabase.from('users').insert([
      {
        role: 'student',
        email,
        first_name: firstName,
        last_name: lastName,
        middle_name: middleInitial || null,
        student_id: studentId,
        is_active: true
      }
    ])

    if (insertError) {
      console.error('Database insert error:', insertError)
      console.error('Error details:', {
        code: insertError.code,
        message: insertError.message,
        details: insertError.details,
        hint: insertError.hint
      })
      // Clean up the auth user if database insert fails
      await supabase.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ 
        error: 'Failed to create student record',
        details: insertError.message
      }, { status: 400 })
    }

    // Use the auth user ID directly for facial data storage
    if (faceDescriptor) {
      try {
        // Store face descriptor in facial_recognition_data table
        const descriptorBuffer = Buffer.from(JSON.stringify(faceDescriptor))
        await supabase.from('facial_recognition_data').insert([
          {
            user_id: authData.user.id,
            face_encoding: descriptorBuffer,
            encoding_version: 'v1.0',
            is_active: true
          }
        ])
      } catch (faceError) {
        console.error('Face descriptor storage error:', faceError)
        // Don't fail registration if face descriptor storage fails
      }
    } else {
      console.warn('No face descriptor provided')
    }

    // Store face image if provided
    if (faceData) {
      try {
        const base64Data = faceData.split(',')[1]
        const buffer = Buffer.from(base64Data, 'base64')
        const fileName = `${authData.user.id}-registration.jpg`

        await supabase.storage
          .from('student-faces')
          .upload(`students/${authData.user.id}/${fileName}`, buffer, {
            contentType: 'image/jpeg',
            upsert: true
          })
      } catch (storageError) {
        console.error('Storage error:', storageError)
        // Don't fail the whole registration if storage fails
      }
    }

    return NextResponse.json({
      success: true,
      credentials: {
        email,
        password,
        firstName,
        lastName
      }
    })
  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
