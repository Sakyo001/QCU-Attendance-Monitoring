import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createServiceRoleClient()
    const { id } = await params

    if (!id) {
      return NextResponse.json({ error: 'Missing item id' }, { status: 400 })
    }

    const body = await request.json()
    const textType = String(body.textType || '').trim() as 'announcement' | 'trivia'
    const title = String(body.title || '').trim()
    const message = String(body.message || '').trim()
    const announcementType = body.announcementType ? String(body.announcementType).trim() : null
    const dateLabel = body.dateLabel ? String(body.dateLabel).trim() : null
    const displayOrder = Number(body.displayOrder || 0)
    const isActive = Boolean(body.isActive ?? true)

    if (textType !== 'announcement' && textType !== 'trivia') {
      return NextResponse.json({ error: 'Invalid text type' }, { status: 400 })
    }

    if (!title || !message) {
      return NextResponse.json({ error: 'Title and message are required' }, { status: 400 })
    }

    const { data, error } = await (supabase as any)
      .from('idle_texts')
      .update({
        text_type: textType,
        title,
        body: message,
        announcement_type: textType === 'announcement' ? (announcementType || 'info') : null,
        date_label: textType === 'announcement' ? dateLabel : null,
        display_order: Number.isFinite(displayOrder) ? displayOrder : 0,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ item: data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update idle text' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createServiceRoleClient()
    const { id } = await params

    if (!id) {
      return NextResponse.json({ error: 'Missing item id' }, { status: 400 })
    }

    const { error } = await (supabase as any)
      .from('idle_texts')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to delete idle text' }, { status: 500 })
  }
}
