import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'

export async function GET() {
  try {
    const supabase = createServiceRoleClient()

    const { data, error } = await (supabase as any)
      .from('idle_texts')
      .select('*')
      .order('text_type', { ascending: true })
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ items: data || [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to load idle text' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient()
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

    if (textType === 'announcement' && announcementType && !['info', 'warning', 'event'].includes(announcementType)) {
      return NextResponse.json({ error: 'Invalid announcement type' }, { status: 400 })
    }

    const { data, error } = await (supabase as any)
      .from('idle_texts')
      .insert({
        text_type: textType,
        title,
        body: message,
        announcement_type: textType === 'announcement' ? (announcementType || 'info') : null,
        date_label: textType === 'announcement' ? dateLabel : null,
        display_order: Number.isFinite(displayOrder) ? displayOrder : 0,
        is_active: isActive,
      })
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ item: data }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to create idle text' }, { status: 500 })
  }
}
