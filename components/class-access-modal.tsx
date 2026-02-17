'use client'

import { useState } from 'react'
import { X, Camera } from 'lucide-react'

interface ClassAccessModalProps {
  isOpen: boolean
  onClose: () => void
  onFaceRecognitionClick: () => void
  isLoading?: boolean
  professorName: string
}

export function ClassAccessModal({                      
  isOpen,
  onClose,
  onFaceRecognitionClick,
  isLoading = false,
  professorName
}: ClassAccessModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Access Class</h2>
            <p className="text-sm text-gray-600 mt-1">Verify your identity to continue</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={isLoading}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Professor Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-gray-600">Logged in as</p>
          <p className="font-semibold text-gray-900">{professorName}</p>
        </div>

        {/* Authentication Options */}
        <div className="grid grid-cols-1 gap-4">
          {/* Face Registration Option */}
          <button
            onClick={onFaceRecognitionClick}
            disabled={isLoading}
            className="relative group flex items-start gap-4 p-4 border-2 border-gray-200 rounded-lg hover:border-violet-500 hover:bg-violet-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex-shrink-0">
              <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-violet-100 group-hover:bg-violet-200 transition-colors">
                <Camera className="h-6 w-6 text-violet-600" />
              </div>
            </div>
            <div className="text-left">
              <p className="font-semibold text-gray-900">Face Recognition</p>
              <p className="text-sm text-gray-600 mt-0.5">
                Use facial recognition to verify your identity
              </p>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="border-t pt-4">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="w-full px-4 py-2 text-gray-700 font-medium bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
