'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

export default function DebugPage() {
  const { user, loading } = useAuth()
  const supabase = createClient()
  const [debugInfo, setDebugInfo] = useState<any>(null)
  const [allSections, setAllSections] = useState<any[]>([])
  const [allProfessors, setAllProfessors] = useState<any[]>([])

  useEffect(() => {
    if (!loading && user) {
      debugUser()
    }
  }, [user, loading])

  const debugUser = async () => {
    try {
      // Get current auth user
      const { data: { user: authUser } } = await supabase.auth.getUser()
      console.log('Auth user:', authUser)

      // Get current user from context
      console.log('Context user:', user)

      // Get sections assigned to current professor
      console.log('Fetching sections with professor_id:', user?.id)
      const { data: myProfessorSections, error: myProfessorSectionsError } = await (supabase as any)
        .from('sections')
        .select('id, section_name, professor_id, room, courses(course_name)')
        .eq('professor_id', user?.id)

      console.log('My sections:', myProfessorSections, 'Error:', myProfessorSectionsError)

      // Get ALL sections (to check if data exists)
      const { data: allSectionsData, error: allSectionsError } = await supabase
        .from('sections')
        .select('id, section_name, professor_id, room')

      console.log('All sections in DB:', allSectionsData?.length || 0, 'Error:', allSectionsError)
      setAllSections(allSectionsData || [])

      // Get ALL professors (to see what professors exist)
      const { data: allProfessorsData, error: allProfessorsError } = await (supabase as any)
        .from('users')
        .select('id, email, role, first_name, last_name')
        .eq('role', 'professor')

      console.log('All professors:', allProfessorsData, 'Error:', allProfessorsError)
      setAllProfessors(allProfessorsData || [])

      setDebugInfo({
        currentUser: {
          id: user?.id,
          email: user?.email,
          role: user?.role,
        },
        authUser: {
          id: authUser?.id,
          email: authUser?.email,
        },
        mySections: myProfessorSections?.length || 0,
        mySectionsData: myProfessorSections || [],
        errors: {
          myProfessorSectionsError,
          allSectionsError,
          allProfessorsError,
        },
      })
    } catch (error) {
      console.error('Debug error:', error)
    }
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Debug Information</h1>
        
        <div className="grid grid-cols-2 gap-8">
          <div>
            <h2 className="text-xl font-bold mb-4">Current User Info</h2>
            <pre className="bg-white p-4 rounded-lg shadow overflow-auto text-sm">
              {JSON.stringify({
                contextUser: {
                  id: user?.id,
                  email: user?.email,
                  role: user?.role,
                },
                debugInfo,
              }, null, 2)}
            </pre>
          </div>

          <div>
            <h2 className="text-xl font-bold mb-4">My Sections ({debugInfo?.mySections || 0})</h2>
            <div className="bg-white p-4 rounded-lg shadow overflow-auto text-sm">
              {debugInfo?.mySectionsData?.length ? (
                <ul className="space-y-2">
                  {debugInfo.mySectionsData.map((section: any) => (
                    <li key={section.id} className="border-b pb-2">
                      <div><strong>{section.section_name}</strong></div>
                      <div className="text-gray-600">{section.courses?.course_name}</div>
                      <div className="text-gray-500 text-xs">Prof ID: {section.professor_id}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500">No sections found for current professor</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-xl font-bold mb-4">All Sections in Database ({allSections.length})</h2>
          <div className="bg-white p-4 rounded-lg shadow overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Section</th>
                  <th className="text-left py-2">Room</th>
                  <th className="text-left py-2">Professor ID</th>
                  <th className="text-left py-2">Is My Section</th>
                </tr>
              </thead>
              <tbody>
                {allSections.map((section: any) => (
                  <tr key={section.id} className="border-b hover:bg-gray-50">
                    <td className="py-2">{section.section_name}</td>
                    <td className="py-2">{section.room}</td>
                    <td className="py-2 text-xs font-mono">{section.professor_id}</td>
                    <td className="py-2">
                      {section.professor_id === user?.id ? (
                        <span className="text-green-600 font-bold">✓ YES</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-xl font-bold mb-4">All Professors ({allProfessors.length})</h2>
          <div className="bg-white p-4 rounded-lg shadow overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Name</th>
                  <th className="text-left py-2">Email</th>
                  <th className="text-left py-2">ID</th>
                  <th className="text-left py-2">Is Current</th>
                </tr>
              </thead>
              <tbody>
                {allProfessors.map((prof: any) => (
                  <tr key={prof.id} className="border-b hover:bg-gray-50">
                    <td className="py-2">{prof.first_name} {prof.last_name}</td>
                    <td className="py-2">{prof.email}</td>
                    <td className="py-2 text-xs font-mono">{prof.id.substring(0, 8)}...</td>
                    <td className="py-2">
                      {prof.id === user?.id ? (
                        <span className="text-green-600 font-bold">✓</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
