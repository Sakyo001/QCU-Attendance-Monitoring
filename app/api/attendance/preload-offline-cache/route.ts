import { NextResponse } from 'next/server'
import { getOfflineStudentsWithFaceDescriptors } from '@/app/api/_utils/offline-kiosk-cache'

/**
 * Pre-load offline cache data for the browser.
 * Returns all students with face descriptors from the offline cache.
 * Used on page load to populate browser localStorage before going offline.
 */
export async function GET() {
  try {
    // Get all students with face descriptors from offline cache
    const allStudents = await getOfflineStudentsWithFaceDescriptors()

    console.log(`📦 Pre-load: Returning ${allStudents.length} students from offline cache`)

    return NextResponse.json({
      success: true,
      students: allStudents.map((s) => ({
        id: s.id,
        studentNumber: s.studentNumber,
        firstName: s.firstName,
        lastName: s.lastName,
        sectionId: s.sectionId,
        faceDescriptor: s.faceDescriptor,
        isActive: s.isActive,
      })),
      source: 'offline-cache',
    })
  } catch (error) {
    console.error('Error pre-loading offline cache:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to pre-load offline cache', students: [] },
      { status: 500 }
    )
  }
}
