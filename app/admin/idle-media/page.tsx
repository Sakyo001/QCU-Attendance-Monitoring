'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Plus, Edit, Trash2, ArrowLeft, Upload, Image as ImageIcon, Video, Eye, X, MessageSquareText, Lightbulb } from 'lucide-react'
import { confirmDelete } from '@/lib/confirm-delete'
import Swal from 'sweetalert2'

interface IdleMediaItem {
  id: string
  title: string
  media_type: 'image' | 'video'
  media_url: string
  display_order: number
  is_active: boolean
  created_at: string
}

interface MediaFormState {
  title: string
  mediaType: 'image' | 'video'
  displayOrder: number
  isActive: boolean
  file: File | null
}

interface IdleTextItem {
  id: string
  text_type: 'announcement' | 'trivia'
  title: string
  body: string
  announcement_type: 'info' | 'warning' | 'event' | null
  date_label: string | null
  display_order: number
  is_active: boolean
  created_at: string
}

interface IdleTextFormState {
  textType: 'announcement' | 'trivia'
  title: string
  message: string
  announcementType: 'info' | 'warning' | 'event'
  dateLabel: string
  displayOrder: number
  isActive: boolean
}

const INITIAL_FORM: MediaFormState = {
  title: '',
  mediaType: 'image',
  displayOrder: 0,
  isActive: true,
  file: null,
}

const FALLBACK_IDLE_MEDIA: IdleMediaItem = {
  id: 'fallback-idle-video',
  title: 'Default Idle Video (Fallback)',
  media_type: 'video',
  media_url: '/idlevideo.mp4',
  display_order: 0,
  is_active: true,
  created_at: '',
}

const INITIAL_TEXT_FORM: IdleTextFormState = {
  textType: 'announcement',
  title: '',
  message: '',
  announcementType: 'info',
  dateLabel: '',
  displayOrder: 0,
  isActive: true,
}

export default function IdleMediaPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [items, setItems] = useState<IdleMediaItem[]>([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<IdleMediaItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<MediaFormState>(INITIAL_FORM)
  const [showPreview, setShowPreview] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewType, setPreviewType] = useState<'image' | 'video' | null>(null)
  const [livePreviewItems, setLivePreviewItems] = useState<IdleMediaItem[]>([])
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  const [textItems, setTextItems] = useState<IdleTextItem[]>([])
  const [loadingTextItems, setLoadingTextItems] = useState(true)
  const [showTextForm, setShowTextForm] = useState(false)
  const [editingTextItem, setEditingTextItem] = useState<IdleTextItem | null>(null)
  const [submittingText, setSubmittingText] = useState(false)
  const [textForm, setTextForm] = useState<IdleTextFormState>(INITIAL_TEXT_FORM)

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [loading, router, user])

  useEffect(() => {
    if (user?.role === 'admin') {
      void fetchItems()
      void fetchLivePreview()
      void fetchTextItems()
    }
  }, [user])

  // Fetch live preview every 5 seconds (what the kiosk sees)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLivePreview()
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchLivePreview = async () => {
    try {
      const response = await fetch('/api/idle-media')
      const payload = await response.json()
      setLivePreviewItems(payload.items || [])
      setLastSyncTime(new Date())
    } catch (error) {
      console.error('Failed to fetch live preview:', error)
    }
  }

  const activeCount = useMemo(() => items.filter((item) => item.is_active).length, [items])
  const effectiveLivePreviewItems = useMemo(
    () => (livePreviewItems.length > 0 ? livePreviewItems : [FALLBACK_IDLE_MEDIA]),
    [livePreviewItems]
  )
  const activeTextCount = useMemo(() => textItems.filter((item) => item.is_active).length, [textItems])
  const activeAnnouncements = useMemo(
    () => textItems
      .filter((item) => item.is_active && item.text_type === 'announcement')
      .sort((a, b) => a.display_order - b.display_order),
    [textItems]
  )
  const activeTrivia = useMemo(
    () => textItems
      .filter((item) => item.is_active && item.text_type === 'trivia')
      .sort((a, b) => a.display_order - b.display_order),
    [textItems]
  )
  const currentDisplayMedia = useMemo(
    () => effectiveLivePreviewItems[0] || null,
    [effectiveLivePreviewItems]
  )

  async function fetchItems() {
    try {
      setLoadingItems(true)
      const response = await fetch('/api/admin/idle-media')
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load idle media')
      }

      setItems(payload.items || [])
    } catch (error: any) {
      console.error('Failed to load idle media:', error)
      await Swal.fire({
        icon: 'error',
        title: 'Failed to load media',
        text: error.message || 'Please try again.',
      })
    } finally {
      setLoadingItems(false)
    }
  }

  async function fetchTextItems() {
    try {
      setLoadingTextItems(true)
      const response = await fetch('/api/admin/idle-text')
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load idle text')
      }

      setTextItems(payload.items || [])
    } catch (error: any) {
      console.error('Failed to load idle text:', error)
      await Swal.fire({
        icon: 'error',
        title: 'Failed to load idle text',
        text: error.message || 'Please try again.',
      })
    } finally {
      setLoadingTextItems(false)
    }
  }

  function openCreateForm() {
    setEditingItem(null)
    setForm(INITIAL_FORM)
    setShowForm(true)
    setShowPreview(false)
    setPreviewUrl(null)
    setPreviewType(null)
  }

  function openEditForm(item: IdleMediaItem) {
    setEditingItem(item)
    setForm({
      title: item.title,
      mediaType: item.media_type,
      displayOrder: item.display_order,
      isActive: item.is_active,
      file: null,
    })
    setShowForm(true)
    setShowPreview(false)
    setPreviewUrl(item.media_url)
    setPreviewType(item.media_type)
  }

  function updatePreview(file?: File) {
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setPreviewUrl(e.target?.result as string)
        setPreviewType(form.mediaType)
      }
      reader.readAsDataURL(file)
    } else if (editingItem && !form.file) {
      setPreviewUrl(editingItem.media_url)
      setPreviewType(editingItem.media_type)
    } else {
      setPreviewUrl(null)
      setPreviewType(null)
    }
  }

  function closeForm() {
    if (submitting) return
    setShowForm(false)
    setEditingItem(null)
    setForm(INITIAL_FORM)
  }

  function openCreateTextForm(type: 'announcement' | 'trivia') {
    setEditingTextItem(null)
    setTextForm({ ...INITIAL_TEXT_FORM, textType: type })
    setShowTextForm(true)
  }

  function openEditTextForm(item: IdleTextItem) {
    setEditingTextItem(item)
    setTextForm({
      textType: item.text_type,
      title: item.title,
      message: item.body,
      announcementType: item.announcement_type || 'info',
      dateLabel: item.date_label || '',
      displayOrder: item.display_order,
      isActive: item.is_active,
    })
    setShowTextForm(true)
  }

  function closeTextForm() {
    if (submittingText) return
    setShowTextForm(false)
    setEditingTextItem(null)
    setTextForm(INITIAL_TEXT_FORM)
  }

  async function handleTextSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!textForm.title.trim() || !textForm.message.trim()) {
      await Swal.fire({ icon: 'warning', title: 'Title and message are required' })
      return
    }

    try {
      setSubmittingText(true)
      const payload = {
        textType: textForm.textType,
        title: textForm.title.trim(),
        message: textForm.message.trim(),
        announcementType: textForm.announcementType,
        dateLabel: textForm.dateLabel.trim(),
        displayOrder: textForm.displayOrder,
        isActive: textForm.isActive,
      }

      const url = editingTextItem ? `/api/admin/idle-text/${editingTextItem.id}` : '/api/admin/idle-text'
      const method = editingTextItem ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save idle text')
      }

      await Swal.fire({
        icon: 'success',
        title: editingTextItem ? 'Text updated' : 'Text added',
        timer: 1300,
        showConfirmButton: false,
      })

      closeTextForm()
      await fetchTextItems()
    } catch (error: any) {
      console.error('Failed to save idle text:', error)
      await Swal.fire({
        icon: 'error',
        title: 'Save failed',
        text: error.message || 'Please try again.',
      })
    } finally {
      setSubmittingText(false)
    }
  }

  async function handleDeleteText(item: IdleTextItem) {
    const confirmed = await confirmDelete({
      title: 'Delete text item?',
      html: `This will permanently delete <b>${item.title}</b>.`,
      confirmButtonText: 'Delete text',
    })

    if (!confirmed) return

    try {
      const response = await fetch(`/api/admin/idle-text/${item.id}`, { method: 'DELETE' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to delete idle text')
      }

      setTextItems((prev) => prev.filter((text) => text.id !== item.id))
      await Swal.fire({
        icon: 'success',
        title: 'Text deleted',
        timer: 1200,
        showConfirmButton: false,
      })
    } catch (error: any) {
      console.error('Failed to delete text:', error)
      await Swal.fire({
        icon: 'error',
        title: 'Delete failed',
        text: error.message || 'Please try again.',
      })
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!form.title.trim()) {
      await Swal.fire({ icon: 'warning', title: 'Title is required' })
      return
    }

    if (!editingItem && !form.file) {
      await Swal.fire({ icon: 'warning', title: 'Please select an image or video file' })
      return
    }

    try {
      setSubmitting(true)
      const body = new FormData()
      body.append('title', form.title.trim())
      body.append('mediaType', form.mediaType)
      body.append('displayOrder', String(form.displayOrder))
      body.append('isActive', String(form.isActive))
      if (form.file) {
        body.append('file', form.file)
      }

      const url = editingItem ? `/api/admin/idle-media/${editingItem.id}` : '/api/admin/idle-media'
      const method = editingItem ? 'PUT' : 'POST'

      const response = await fetch(url, { method, body })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save idle media')
      }

      await Swal.fire({
        icon: 'success',
        title: editingItem ? 'Media updated' : 'Media added',
        timer: 1400,
        showConfirmButton: false,
      })

      closeForm()
      await fetchItems()
      await fetchLivePreview() // Refresh live preview immediately
    } catch (error: any) {
      console.error('Failed to save media:', error)
      await Swal.fire({
        icon: 'error',
        title: 'Save failed',
        text: error.message || 'Please try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(item: IdleMediaItem) {
    const confirmed = await confirmDelete({
      title: 'Delete media item?',
      html: `This will permanently delete <b>${item.title}</b>.`,
      confirmButtonText: 'Delete media',
    })

    if (!confirmed) return

    try {
      const response = await fetch(`/api/admin/idle-media/${item.id}`, {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to delete media')
      }

      setItems((prev) => prev.filter((media) => media.id !== item.id))
      await Swal.fire({
        icon: 'success',
        title: 'Media deleted',
        timer: 1200,
        showConfirmButton: false,
      })
      await fetchLivePreview() // Refresh live preview
    } catch (error: any) {
      console.error('Failed to delete media:', error)
      await Swal.fire({
        icon: 'error',
        title: 'Delete failed',
        text: error.message || 'Please try again.',
      })
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user || user.role !== 'admin') {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/admin')}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Idle Media Manager</h1>
                <p className="text-sm text-gray-600 mt-1">
                  Manage images and videos shown in idle mode — Changes sync live to kiosks.
                </p>
              </div>
            </div>
            <button
              onClick={openCreateForm}
              className="inline-flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Media
            </button>
          </div>
        </div>
        
        {/* Live Sync Info Banner */}
        <div className="bg-green-50 border-t border-green-200 px-4 sm:px-6 lg:px-8 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-2 text-sm text-green-800">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
            <span className="font-medium">Live Connection Active</span>
            <span className="text-green-700">—</span>
            <span className="text-green-700">
              Any changes you make are immediately broadcast to all kiosk displays. Active media updates every 5 seconds.
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Total Items</p>
            <p className="text-2xl font-bold text-gray-900">{items.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Active Items</p>
            <p className="text-2xl font-bold text-emerald-600">{activeCount}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Inactive Items</p>
            <p className="text-2xl font-bold text-amber-600">{Math.max(items.length - activeCount, 0)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Text Items</p>
            <p className="text-2xl font-bold text-gray-900">{textItems.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Active Text</p>
            <p className="text-2xl font-bold text-emerald-600">{activeTextCount}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Inactive Text</p>
            <p className="text-2xl font-bold text-amber-600">{Math.max(textItems.length - activeTextCount, 0)}</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Idle Mode Layout Editor</h2>
              <p className="text-sm text-gray-500">Preview mirrors the actual idle screen layout with inline content actions.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchLivePreview()}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                <Eye className="w-4 h-4" />
                Refresh
              </button>
              <button
                onClick={openCreateForm}
                className="inline-flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Media
              </button>
            </div>
          </div>

          <div className="p-4 bg-gray-50">
            <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm font-semibold text-gray-800">Live Kiosk Layout</span>
                </div>
                <span className="text-xs text-gray-500">
                  {lastSyncTime ? `Synced ${lastSyncTime.toLocaleTimeString()}` : 'Syncing...'}
                </span>
              </div>

              <div className="grid grid-cols-[1fr_0.45fr] grid-rows-[1fr_0.45fr] gap-3 p-3 min-h-120">
                <div className="row-span-2 rounded-2xl border border-gray-200 overflow-hidden bg-gray-900 relative shadow-sm">
                  {currentDisplayMedia?.media_type === 'image' ? (
                    <img src={currentDisplayMedia.media_url} alt={currentDisplayMedia.title} className="w-full h-full object-cover" />
                  ) : (
                    <video
                      src={currentDisplayMedia?.media_url || '/idlevideo.mp4'}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  )}

                  <div className="absolute bottom-3 left-3 bg-black/45 backdrop-blur-sm rounded-lg px-3 py-1.5">
                    <p className="text-white/90 text-xs font-medium tracking-wider uppercase">
                      {currentDisplayMedia?.title || 'Now Playing'}
                    </p>
                  </div>

                  <div className="absolute top-3 right-3 flex items-center gap-2">
                    {currentDisplayMedia && currentDisplayMedia.id !== FALLBACK_IDLE_MEDIA.id && (
                      <>
                        <button
                          onClick={() => openEditForm(currentDisplayMedia)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-white/90 text-gray-800 hover:bg-white"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(currentDisplayMedia)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-red-500/90 text-white hover:bg-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Announcements</h3>
                    <button
                      onClick={() => openCreateTextForm('announcement')}
                      className="text-xs px-2 py-1 border rounded-md hover:bg-gray-50"
                    >
                      Add
                    </button>
                  </div>
                  <div className="space-y-2 overflow-y-auto pr-1 max-h-56">
                    {(activeAnnouncements.length > 0 ? activeAnnouncements : []).map((a) => (
                      <div key={a.id} className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="text-gray-800 text-sm font-semibold truncate">{a.title}</h4>
                            <p className="text-gray-500 text-xs mt-0.5 line-clamp-2 leading-relaxed">{a.body}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => openEditTextForm(a)}
                              className="p-1.5 rounded-md bg-white text-gray-700 hover:bg-gray-100"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteText(a)}
                              className="p-1.5 rounded-md bg-red-500 text-white hover:bg-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {activeAnnouncements.length === 0 && (
                      <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-500">
                        No active announcements.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden flex flex-col p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Trivia</h3>
                    <button
                      onClick={() => openCreateTextForm('trivia')}
                      className="text-xs px-2 py-1 border rounded-md hover:bg-gray-50"
                    >
                      Add
                    </button>
                  </div>
                  <div className="space-y-2 overflow-y-auto pr-1 max-h-40">
                    {(activeTrivia.length > 0 ? activeTrivia : []).map((t) => (
                      <div key={t.id} className="p-3 rounded-xl bg-yellow-50 border border-yellow-200">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-amber-700 text-sm font-semibold truncate">{t.title}</p>
                            <p className="text-gray-600 text-xs mt-0.5 line-clamp-2">{t.body}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => openEditTextForm(t)}
                              className="p-1.5 rounded-md bg-white text-gray-700 hover:bg-gray-100"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteText(t)}
                              className="p-1.5 rounded-md bg-red-500 text-white hover:bg-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {activeTrivia.length === 0 && (
                      <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-500">
                        No active trivia items.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-xl bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingItem ? 'Edit Idle Media' : 'Add Idle Media'}
              </h3>
              <button onClick={closeForm} className="text-sm text-gray-500 hover:text-gray-800">
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  value={form.title}
                  onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="Campus highlights"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Media Type</label>
                  <select
                    value={form.mediaType}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        mediaType: event.target.value as 'image' | 'video',
                      }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
                  <input
                    type="number"
                    value={form.displayOrder}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, displayOrder: Number(event.target.value) || 0 }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    min={0}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                />
                Active in idle mode
              </label>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {editingItem ? 'Replace File (Optional)' : 'Upload File'}
                </label>
                <input
                  type="file"
                  accept={form.mediaType === 'image' ? 'image/*' : 'video/*'}
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null
                    setForm((prev) => ({ ...prev, file }))
                    updatePreview(file)
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {form.mediaType === 'image' ? 'Accepted: image files' : 'Accepted: video files'}
                </p>
              </div>

              {editingItem && !form.file && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                  Current file will be kept unless you upload a replacement.
                </div>
              )}

              {/* Live Preview */}
              {previewUrl && previewType && (
                <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-3">
                  <p className="text-xs font-medium text-blue-900 mb-2">Preview</p>
                  <div className="w-full h-40 bg-black rounded-lg overflow-hidden">
                    {previewType === 'image' ? (
                      <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <video src={previewUrl} className="w-full h-full object-cover" controls muted autoPlay />
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
                  disabled={submitting}
                >
                  Cancel
                </button>
                {previewUrl && previewType && (
                  <button
                    type="button"
                    onClick={() => setShowPreview(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50"
                  >
                    <Eye className="w-4 h-4" />
                    Preview
                  </button>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-60"
                >
                  <Upload className="w-4 h-4" />
                  {submitting ? 'Saving...' : editingItem ? 'Save Changes' : 'Upload Media'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Full Preview Modal */}
      {showPreview && previewUrl && previewType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900">Media Preview</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-500 hover:text-gray-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <div className="w-full bg-black rounded-lg overflow-hidden">
                {previewType === 'image' ? (
                  <img src={previewUrl} alt="Full preview" className="w-full h-auto max-h-96 object-contain mx-auto" />
                ) : (
                  <video
                    src={previewUrl}
                    className="w-full h-auto max-h-96 mx-auto"
                    controls
                    autoPlay
                    muted
                    style={{ objectFit: 'contain' }}
                  />
                )}
              </div>
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">Title:</span> {form.title || 'Untitled'}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  <span className="font-medium text-gray-900">Type:</span> {form.mediaType === 'image' ? 'Image' : 'Video'}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  <span className="font-medium text-gray-900">Display Order:</span> {form.displayOrder}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  <span className="font-medium text-gray-900">Status:</span>{' '}
                  <span className={form.isActive ? 'text-emerald-600 font-medium' : 'text-gray-500 font-medium'}>
                    {form.isActive ? 'Active' : 'Inactive'}
                  </span>
                </p>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowPreview(false)}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {showTextForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-xl bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingTextItem ? 'Edit Idle Text' : 'Add Idle Text'}
              </h3>
              <button onClick={closeTextForm} className="text-sm text-gray-500 hover:text-gray-800">
                Close
              </button>
            </div>

            <form onSubmit={handleTextSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Text Type</label>
                  <select
                    value={textForm.textType}
                    onChange={(event) =>
                      setTextForm((prev) => ({
                        ...prev,
                        textType: event.target.value as 'announcement' | 'trivia',
                      }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="announcement">Announcement</option>
                    <option value="trivia">Trivia</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
                  <input
                    type="number"
                    value={textForm.displayOrder}
                    onChange={(event) =>
                      setTextForm((prev) => ({ ...prev, displayOrder: Number(event.target.value) || 0 }))
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    min={0}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {textForm.textType === 'announcement' ? 'Title' : 'Question'}
                </label>
                <input
                  value={textForm.title}
                  onChange={(event) => setTextForm((prev) => ({ ...prev, title: event.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {textForm.textType === 'announcement' ? 'Message' : 'Answer'}
                </label>
                <textarea
                  value={textForm.message}
                  onChange={(event) => setTextForm((prev) => ({ ...prev, message: event.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 min-h-28"
                  required
                />
              </div>

              {textForm.textType === 'announcement' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Announcement Type</label>
                    <select
                      value={textForm.announcementType}
                      onChange={(event) =>
                        setTextForm((prev) => ({
                          ...prev,
                          announcementType: event.target.value as 'info' | 'warning' | 'event',
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="info">Info</option>
                      <option value="warning">Warning</option>
                      <option value="event">Event</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date Label</label>
                    <input
                      value={textForm.dateLabel}
                      onChange={(event) => setTextForm((prev) => ({ ...prev, dateLabel: event.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      placeholder="2026-03-10"
                    />
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={textForm.isActive}
                  onChange={(event) => setTextForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                />
                Active in idle mode
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeTextForm}
                  className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
                  disabled={submittingText}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingText}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-60"
                >
                  {submittingText ? 'Saving...' : editingTextItem ? 'Save Changes' : 'Add Text'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
