'use client'

import { useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Loader2, Check } from 'lucide-react'

interface EditFaceModalProps {
  student: any
  onClose: () => void
  onSuccess: () => void
}

export function EditFaceModal({ student, onClose, onSuccess }: EditFaceModalProps) {
  const [formData, setFormData] = useState({
    firstName: student.first_name || '',
    lastName: student.last_name || '',
    studentId: student.student_id || '',
    email: student.email || ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loadingEmail, setLoadingEmail] = useState(false)

  // Fetch email from users table if not provided
  const fetchEmail = async () => {
    if (formData.email) return // Already have email
    
    setLoadingEmail(true)
    try {
      const response = await fetch(`/api/professor/attendance/get-student-email?studentId=${student.student_id}`)
      const data = await response.json()
      if (data.success && data.email) {
        setFormData(prev => ({ ...prev, email: data.email }))
      }
    } catch (error) {
      console.error('Error fetching email:', error)
    } finally {
      setLoadingEmail(false)
    }
  }

  // Fetch email on mount if not available
  useEffect(() => {
    if (!formData.email && student.student_id) {
      fetchEmail()
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError('')

    try {
      const response = await fetch(`/api/professor/attendance/update-student`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: student.id,
          firstName: formData.firstName,
          lastName: formData.lastName,
          studentId: formData.studentId,
          email: formData.email
        })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to update student')
        return
      }

      onSuccess()
    } catch (error) {
      console.error('Error updating student:', error)
      setError('Failed to update student information')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Edit Student Information</CardTitle>
          <CardDescription>Update student details</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Student Avatar */}
          <div className="flex justify-center mb-4">
            <Avatar className="h-20 w-20 border-2 border-gray-200">
              <AvatarImage src={student.avatar_url || ''} />
              <AvatarFallback className="bg-emerald-100 text-emerald-700 text-xl font-bold">
                {student.first_name?.charAt(0) || ''}{student.last_name?.charAt(0) || ''}
              </AvatarFallback>
            </Avatar>
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm p-3 rounded border border-red-200">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                First Name
              </label>
              <input
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Last Name
              </label>
              <input
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Student ID
              </label>
              <input
                type="text"
                name="studentId"
                value={formData.studentId}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                disabled={loadingEmail}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
              {loadingEmail && <p className="text-xs text-gray-500 mt-1">Loading email...</p>}
            </div>

            <div className="pt-2 flex gap-2">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Save Changes
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
