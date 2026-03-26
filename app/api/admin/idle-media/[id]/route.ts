import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'

const IDLE_MEDIA_BUCKET = 'idle-media'

function sanitizeFilename(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function extractStoragePath(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${IDLE_MEDIA_BUCKET}/`
  const markerIndex = publicUrl.indexOf(marker)
  if (markerIndex < 0) return null
  return decodeURIComponent(publicUrl.slice(markerIndex + marker.length))
}

async function ensureIdleMediaBucket(supabase: any) {
  const { data: buckets, error } = await supabase.storage.listBuckets()
  if (error) throw error

  const exists = (buckets || []).some((bucket: any) => bucket.name === IDLE_MEDIA_BUCKET)
  if (exists) return

  const { error: createError } = await supabase.storage.createBucket(IDLE_MEDIA_BUCKET, {
    public: true,
    fileSizeLimit: '52428800',
    allowedMimeTypes: ['image/*', 'video/*'],
  })

  if (createError) throw createError
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createServiceRoleClient()
    await ensureIdleMediaBucket(supabase)

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing media id' }, { status: 400 })
    }

    const { data: existing, error: existingError } = await (supabase as any)
      .from('idle_media')
      .select('*')
      .eq('id', id)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Media item not found' }, { status: 404 })
    }

    const formData = await request.formData()
    const title = String(formData.get('title') || '').trim()
    const mediaType = String(formData.get('mediaType') || '').trim() as 'image' | 'video'
    const displayOrder = Number(formData.get('displayOrder') || 0)
    const isActive = String(formData.get('isActive') || 'true') === 'true'
    const file = formData.get('file') as File | null

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    if (mediaType !== 'image' && mediaType !== 'video') {
      return NextResponse.json({ error: 'Invalid media type' }, { status: 400 })
    }

    if (!file && mediaType !== existing.media_type) {
      return NextResponse.json(
        { error: 'Changing media type requires uploading a replacement file' },
        { status: 400 }
      )
    }

    let mediaUrl = existing.media_url
    let mimeType = existing.mime_type
    let fileSizeBytes = existing.file_size_bytes
    let oldPathToDelete: string | null = null

    if (file) {
      if (mediaType === 'image' && !file.type.startsWith('image/')) {
        return NextResponse.json({ error: 'Selected file is not an image' }, { status: 400 })
      }

      if (mediaType === 'video' && !file.type.startsWith('video/')) {
        return NextResponse.json({ error: 'Selected file is not a video' }, { status: 400 })
      }

      const safeName = sanitizeFilename(file.name)
      const filePath = `${mediaType}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`
      const fileBuffer = await file.arrayBuffer()

      const { error: uploadError } = await supabase.storage
        .from(IDLE_MEDIA_BUCKET)
        .upload(filePath, fileBuffer, {
          contentType: file.type,
          upsert: false,
        })

      if (uploadError) {
        return NextResponse.json({ error: uploadError.message }, { status: 500 })
      }

      const { data: publicData } = supabase.storage.from(IDLE_MEDIA_BUCKET).getPublicUrl(filePath)
      mediaUrl = publicData.publicUrl
      mimeType = file.type || null
      fileSizeBytes = file.size || null
      oldPathToDelete = extractStoragePath(existing.media_url)
    }

    const { data: updated, error: updateError } = await (supabase as any)
      .from('idle_media')
      .update({
        title,
        media_type: mediaType,
        media_url: mediaUrl,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        display_order: Number.isFinite(displayOrder) ? displayOrder : 0,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    if (oldPathToDelete) {
      await supabase.storage.from(IDLE_MEDIA_BUCKET).remove([oldPathToDelete])
    }

    return NextResponse.json({ item: updated })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update idle media' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createServiceRoleClient()
    const { id } = await params

    if (!id) {
      return NextResponse.json({ error: 'Missing media id' }, { status: 400 })
    }

    const { data: existing, error: existingError } = await (supabase as any)
      .from('idle_media')
      .select('id, media_url')
      .eq('id', id)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Media item not found' }, { status: 404 })
    }

    const { error: deleteError } = await (supabase as any)
      .from('idle_media')
      .delete()
      .eq('id', id)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    const storagePath = extractStoragePath(existing.media_url)
    if (storagePath) {
      await supabase.storage.from(IDLE_MEDIA_BUCKET).remove([storagePath])
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to delete idle media' }, { status: 500 })
  }
}
