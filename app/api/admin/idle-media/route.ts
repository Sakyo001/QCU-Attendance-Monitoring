import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'

const IDLE_MEDIA_BUCKET = 'idle-media'

function sanitizeFilename(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
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

export async function GET() {
  try {
    const supabase = createServiceRoleClient()

    const { data, error } = await (supabase as any)
      .from('idle_media')
      .select('*')
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ items: data || [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to load idle media' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient()
    await ensureIdleMediaBucket(supabase)

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

    if (!file) {
      return NextResponse.json({ error: 'Media file is required' }, { status: 400 })
    }

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

    const { data: inserted, error: insertError } = await (supabase as any)
      .from('idle_media')
      .insert({
        title,
        media_type: mediaType,
        media_url: publicData.publicUrl,
        mime_type: file.type || null,
        file_size_bytes: file.size || null,
        display_order: Number.isFinite(displayOrder) ? displayOrder : 0,
        is_active: isActive,
      })
      .select('*')
      .single()

    if (insertError) {
      await supabase.storage.from(IDLE_MEDIA_BUCKET).remove([filePath])
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ item: inserted }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to create idle media' }, { status: 500 })
  }
}
