import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { writeFile, mkdir, readdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { professorId, firstName, lastName, faceData, faceDescriptor } = body

    console.log('📥 Professor registration request:')
    console.log('   - Professor ID:', professorId)
    console.log('   - Name:', firstName, lastName)
    console.log('   - Has faceData:', !!faceData)
    console.log('   - Has faceDescriptor:', !!faceDescriptor)
    console.log('   - Descriptor type:', typeof faceDescriptor)
    console.log('   - Descriptor is array:', Array.isArray(faceDescriptor))
    console.log('   - Descriptor length:', faceDescriptor?.length)

    // Validate required fields
    if (!professorId || !firstName || !lastName || !faceData) {
      return NextResponse.json(
        { error: 'All fields are required (professorId, firstName, lastName, faceData)' },
        { status: 400 }
      )
    }

    // Validate face descriptor (keras-facenet provides 512-dimension embeddings)
    if (!faceDescriptor || !Array.isArray(faceDescriptor) || faceDescriptor.length !== 512) {
      console.error('❌ Invalid face descriptor:', {
        exists: !!faceDescriptor,
        isArray: Array.isArray(faceDescriptor),
        length: faceDescriptor?.length,
        expected: 512
      })
      return NextResponse.json(
        { error: 'Invalid face descriptor. Please recapture your photo.' },
        { status: 400 }
      )
    }

    // Save image locally with incremental naming
    let imageUrl = ''
    if (faceData) {
      try {
        const base64Data = faceData.split(',')[1]
        const buffer = Buffer.from(base64Data, 'base64')
        
        // Create directory if it doesn't exist
        const faceRegDir = join(process.cwd(), 'public', 'face-registrations')
        if (!existsSync(faceRegDir)) {
          await mkdir(faceRegDir, { recursive: true })
        }

        // Determine the next available number for this professor
        const baseFileName = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.prof`
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
        imageUrl = `/face-registrations/${fileName}`
        
        console.log('✅ Professor face image saved:', imageUrl)
      } catch (fileError) {
        console.error('File save error:', fileError)
        // Continue even if file save fails
      }
    }

    // Create Supabase client with service role (bypass RLS for API routes)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check if professor already has a registration
    const { data: existing, error: checkError } = await supabase
      .from('professor_face_registrations')
      .select('id')
      .eq('professor_id', professorId)
      .single()

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking existing registration:', checkError)
    }

    if (existing) {
      // Update existing registration
      const { data, error } = await supabase
        .from('professor_face_registrations')
        .update({
          first_name: firstName,
          last_name: lastName,
          face_data: faceData,
          face_descriptor: faceDescriptor || null,
          image_url: imageUrl,
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('professor_id', professorId)
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
        .from('professor_face_registrations')
        .insert({
          professor_id: professorId,
          first_name: firstName,
          last_name: lastName,
          face_data: faceData,
          face_descriptor: faceDescriptor || null,
          image_url: imageUrl,
          is_active: true
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
