import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function PUT(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()

    const { registrationId, faceData, faceDescriptor } = body

    if (!registrationId || !faceData || !faceDescriptor) {
      return NextResponse.json(
        { error: 'Missing required fields: registrationId, faceData, faceDescriptor' },
        { status: 400 }
      )
    }

    if (!Array.isArray(faceDescriptor) || faceDescriptor.length === 0) {
      return NextResponse.json(
        { error: 'faceDescriptor must be a non-empty array' },
        { status: 400 }
      )
    }

    console.log('📸 Updating face data for registration:', registrationId)
    console.log('   - Descriptor length:', faceDescriptor.length)
    console.log('   - Face image length:', faceData.length)

    const { data, error } = await supabase
      .from('student_face_registrations')
      .update({
        face_data: faceData,
        face_descriptor: faceDescriptor,
        updated_at: new Date().toISOString()
      })
      .eq('id', registrationId)
      .select()

    if (error) {
      console.error('❌ Error updating face data:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Registration not found' },
        { status: 404 }
      )
    }

    console.log('✅ Face data updated successfully')

    return NextResponse.json({
      success: true,
      message: 'Face data updated successfully'
    })
  } catch (error: any) {
    console.error('❌ Exception:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
