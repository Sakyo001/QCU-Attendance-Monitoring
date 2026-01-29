import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, readdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { firstName, lastName, middleInitial, studentId, email, sectionId, faceData, faceDescriptor } = body

    console.log('📝 Student registration request received:', {
      firstName,
      lastName,
      studentId,
      email,
      sectionId,
      hasFaceData: !!faceData,
      faceDataLength: faceData?.length || 0,
      hasFaceDescriptor: !!faceDescriptor,
      faceDescriptorType: typeof faceDescriptor,
      faceDescriptorLength: Array.isArray(faceDescriptor) ? faceDescriptor.length : 'not array'
    })

    if (!firstName || !lastName || !studentId || !email) {
      return NextResponse.json({ error: 'First name, last name, student ID, and email are required' }, { status: 400 })
    }

    // Pre-check: verify email doesn't exist in users table
    const { data: existingUser, error: checkUserError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .limit(1)

    if (checkUserError) {
      console.error('Error checking existing user:', checkUserError)
      return NextResponse.json({ error: 'Failed to validate email' }, { status: 500 })
    }

    if (existingUser && existingUser.length > 0) {
      return NextResponse.json({ 
        error: 'This email is already registered in the system'
      }, { status: 400 })
    }

    // Pre-check: verify email doesn't exist in auth.users table
    const { data: authUsers, error: authListError } = await supabase.auth.admin.listUsers()

    if (authListError) {
      console.error('Error checking auth users:', authListError)
      return NextResponse.json({ error: 'Failed to validate email' }, { status: 500 })
    }

    const emailExistsInAuth = authUsers.users.some(user => user.email === email)
    if (emailExistsInAuth) {
      return NextResponse.json({ 
        error: 'This email is already registered. Please use a different email address.'
      }, { status: 400 })
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
      return NextResponse.json({ 
        error: 'Failed to create auth user',
        details: authError.message
      }, { status: 400 })
    }

    const userId = authData.user.id

    // Create student record in users table
    const { error: insertError } = await supabase.from('users').insert([
      {
        id: userId,
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
      // Clean up the auth user if database insert fails
      await supabase.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ 
        error: 'Failed to create student record',
        details: insertError.message
      }, { status: 400 })
    }

    // Save face image to public/face-registrations folder
    let imagePath = ''
    if (faceData) {
      try {
        const base64Data = faceData.split(',')[1]
        const buffer = Buffer.from(base64Data, 'base64')
        
        // Create directory if it doesn't exist
        const faceRegDir = join(process.cwd(), 'public', 'face-registrations')
        if (!existsSync(faceRegDir)) {
          await mkdir(faceRegDir, { recursive: true })
        }

        // Determine the next available number for this user
        const baseFileName = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`
        const existingFiles = await readdir(faceRegDir)
        const userFiles = existingFiles.filter(file => file.startsWith(baseFileName))
        
        // Find the next number (001, 002, etc.)
        let nextNumber = 1
        if (userFiles.length > 0) {
          const numbers = userFiles.map(file => {
            const match = file.match(/(\d{3})\.(jpg|jpeg|png)$/i)
            return match ? parseInt(match[1]) : 0
          })
          nextNumber = Math.max(...numbers) + 1
        }

        const fileName = `${baseFileName}${String(nextNumber).padStart(3, '0')}.jpg`
        const filePath = join(faceRegDir, fileName)
        
        await writeFile(filePath, buffer)
        imagePath = `/face-registrations/${fileName}`
        
        console.log('Face image saved:', imagePath)
      } catch (fileError) {
        console.error('File save error:', fileError)
        // Continue even if file save fails
      }
    }

    // Always store in student_face_registrations table
    try {
      console.log('About to insert into student_face_registrations with:', {
        student_number: studentId,
        first_name: firstName,
        last_name: lastName,
        section_id: sectionId || null,
        face_data_type: typeof (imagePath || faceData),
        face_data_length: (imagePath || faceData)?.length || 0,
        face_descriptor_type: typeof faceDescriptor,
        face_descriptor_is_array: Array.isArray(faceDescriptor),
        face_descriptor_length: Array.isArray(faceDescriptor) ? faceDescriptor.length : (faceDescriptor ? faceDescriptor.length : 0),
        final_descriptor_is_array: Array.isArray(faceDescriptor) || (faceDescriptor && typeof faceDescriptor === 'object'),
        final_descriptor_length: Array.isArray(faceDescriptor) ? faceDescriptor.length : (faceDescriptor?.length || 0)
      })

      const insertPayload = {
        student_number: studentId,
        first_name: firstName,
        last_name: lastName,
        section_id: sectionId || null,
        face_data: imagePath || faceData || null,
        face_descriptor: Array.isArray(faceDescriptor) ? faceDescriptor : (faceDescriptor ? Array.from(faceDescriptor) : null),
        is_active: true
      }

      console.log('Insert payload:', insertPayload)

      const { data: faceRegData, error: faceRegError } = await supabase
        .from('student_face_registrations')
        .insert([insertPayload])
        .select()

      if (faceRegError) {
        console.error('❌ Face registration INSERT error:', faceRegError)
        console.error('Error code:', faceRegError.code)
        console.error('Error message:', faceRegError.message)
        console.error('Error details:', faceRegError.details)
        console.error('Error hint:', faceRegError.hint)
        // Still return success since the user record was created
      } else {
        console.log('✅ Face registration successful:', faceRegData)
      }
    } catch (faceError) {
      console.error('❌ Face registration try-catch error:', faceError)
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
