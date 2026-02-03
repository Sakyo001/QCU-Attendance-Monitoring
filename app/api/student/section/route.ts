import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const studentId = request.nextUrl.searchParams.get('studentId')

    if (!studentId) {
      return NextResponse.json({ 
        error: 'Student ID is required' 
      }, { status: 400 })
    }

    // First, get the student_number from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('student_id')
      .eq('id', studentId)
      .single()

    if (userError || !userData?.student_id) {
      return NextResponse.json({ 
        success: true,
        section: null,
        message: 'Student not found'
      })
    }

    // Get student's section from attendance_records using student_number
    const { data: attendanceData, error: attendanceError } = await supabase
      .from('attendance_records')
      .select('section_id')
      .eq('student_number', userData.student_id)
      .limit(1)

    console.log('🔍 Looking for attendance records for student_number:', userData.student_id)
    console.log('   Found:', attendanceData?.length || 0, 'records')

    if (attendanceError && attendanceError.code !== 'PGRST116') {
      console.error('Error fetching student section:', attendanceError)
      return NextResponse.json({ 
        success: true,
        section: null,
        message: 'Failed to fetch section'
      })
    }

    if (!attendanceData || attendanceData.length === 0) {
      console.log('⚠️ No attendance records found, checking face registrations...')
      // Student has no attendance records, try to find from student_face_registrations
      const { data: faceRegData, error: faceRegError } = await supabase
        .from('student_face_registrations')
        .select('section_id')
        .eq('student_number', userData.student_id)
        .limit(1)

      if (faceRegError && faceRegError.code !== 'PGRST116') {
        console.error('Error fetching from face registrations:', faceRegError)
      }

      if (!faceRegData || faceRegData.length === 0 || !faceRegData[0].section_id) {
        console.log('❌ No section found in face registrations for student:', userData.student_id)
        return NextResponse.json({ 
          success: true,
          section: null,
          message: 'Student not enrolled in any section'
        })
      }

      const sectionId = faceRegData[0].section_id

      console.log('✅ Found section_id from face registrations:', sectionId)

      // Fetch section details - need to cast section_id as it's stored as text but sections.id is uuid
      const { data: sectionData, error: sectionError } = await supabase
        .from('sections')
        .select('id, section_code, semester, academic_year')
        .eq('id', sectionId ? sectionId.toString() : null)
        .single()

      if (sectionError) {
        console.error('Error fetching section details:', sectionError)
        console.error('Section ID was:', sectionId, 'Type:', typeof sectionId)
        return NextResponse.json({ 
          success: true,
          section: null,
          message: 'Failed to fetch section details: ' + sectionError.message
        })
      }

      if (!sectionData) {
        console.error('No section data found for section_id:', sectionId)
        return NextResponse.json({ 
          success: true,
          section: null,
          message: 'Section not found'
        })
      }

      // Get professor from class_sessions
      const sectionIdStr = String(sectionId)
      const { data: classSessionData } = await supabase
        .from('class_sessions')
        .select('professor_id')
        .eq('section_id', sectionIdStr)
        .limit(1)
      
      let professorName = 'Unknown'
      if (classSessionData && classSessionData.length > 0 && classSessionData[0].professor_id) {
        const { data: professorData } = await supabase
          .from('users')
          .select('first_name, last_name')
          .eq('id', classSessionData[0].professor_id)
          .single()

        if (professorData) {
          professorName = `${professorData.first_name} ${professorData.last_name}`
        }
      }

      return NextResponse.json({ 
        success: true,
        section: {
          ...sectionData,
          professor_name: professorName
        }
      })
    }

    const sectionId = attendanceData[0].section_id

    console.log('🔍 Found attendance records for student:', userData.student_id)
    console.log('   Section ID from attendance:', sectionId, 'Type:', typeof sectionId)

    // Check if section_id is null
    if (!sectionId) {
      console.log('⚠️ Section ID is null in attendance records, checking face registrations...')
      
      const { data: faceRegData, error: faceRegError } = await supabase
        .from('student_face_registrations')
        .select('section_id')
        .eq('student_number', userData.student_id)
        .limit(1)

      if (faceRegError && faceRegError.code !== 'PGRST116') {
        console.error('Error fetching from face registrations:', faceRegError)
      }

      if (!faceRegData || faceRegData.length === 0 || !faceRegData[0]?.section_id) {
        console.log('❌ No section found in face registrations either')
        return NextResponse.json({ 
          success: true,
          section: null,
          message: 'Student not enrolled in any section'
        })
      }

      const fallbackSectionId = faceRegData[0].section_id
      console.log('✅ Found section_id from face registrations:', fallbackSectionId)

      // Use the fallback section ID
      const { data: sectionData, error: sectionError } = await supabase
        .from('sections')
        .select('id, section_code, semester, academic_year, professor_id')
        .eq('id', fallbackSectionId.toString())
        .single()

      if (sectionError) {
        console.error('Error fetching section details:', sectionError)
        return NextResponse.json({ 
          success: true,
          section: null,
          message: 'Failed to fetch section details'
        })
      }

      if (!sectionData) {
        return NextResponse.json({ 
          success: true,
          section: null,
          message: 'Section not found'
        })
      }

      const { data: professorData } = await supabase
        .from('users')
        .select('first_name, last_name')
        .eq('id', sectionData.professor_id)
        .single()

      return NextResponse.json({ 
        success: true,
        section: {
          ...sectionData,
          professor_name: professorData 
            ? `${professorData.first_name} ${professorData.last_name}`
            : 'Unknown'
        }
      })
    }

    console.log('✅ Found section_id from attendance records:', sectionId)
    console.log('   Type:', typeof sectionId)
    console.log('   Stringified:', String(sectionId))

    // Fetch section details - sectionId is UUID from attendance_records
    const sectionIdStr = String(sectionId)
    console.log('🔍 Querying sections table with id:', sectionIdStr)
    
    const { data: sectionData, error: sectionError } = await supabase
      .from('sections')
      .select('id, section_code, semester, academic_year')
      .eq('id', sectionIdStr)
      .single()

    console.log('📊 Query result - Error:', sectionError)
    console.log('📊 Query result - Data:', sectionData)

    if (sectionError) {
      console.error('❌ Error fetching section details:', sectionError)
      console.error('   Section ID was:', sectionIdStr)
      return NextResponse.json({ 
        success: true,
        section: null,
        message: 'Failed to fetch section details: ' + sectionError.message
      })
    }

    if (!sectionData) {
      console.error('❌ No section data found for section_id:', sectionIdStr)
      return NextResponse.json({ 
        success: true,
        section: null,
        message: 'Section not found'
      })
    }

    // Get professor from class_sessions (linked through section_id)
    const { data: classSessionData } = await supabase
      .from('class_sessions')
      .select('professor_id')
      .eq('section_id', sectionIdStr)
      .limit(1)
    
    let professorName = 'Unknown'
    if (classSessionData && classSessionData.length > 0 && classSessionData[0].professor_id) {
      const { data: professorData } = await supabase
        .from('users')
        .select('first_name, last_name')
        .eq('id', classSessionData[0].professor_id)
        .single()

      if (professorData) {
        professorName = `${professorData.first_name} ${professorData.last_name}`
      }
    }

    return NextResponse.json({ 
      success: true,
      section: {
        ...sectionData,
        professor_name: professorName
      }
    })

  } catch (error: any) {
    console.error('Exception in section fetch:', error)
    return NextResponse.json({ 
      error: error.message || 'Failed to fetch section' 
    }, { status: 500 })
  }
}
