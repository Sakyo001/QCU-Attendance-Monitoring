import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'

export async function GET() {
  try {
    const supabase = createServiceRoleClient()

    const { data, error } = await (supabase as any)
      .from('idle_texts')
      .select('id, text_type, title, body, announcement_type, date_label, display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ announcements: [], trivia: [] }, { status: 200 })
    }

    const items = Array.isArray(data) ? data : []
    const announcements = items
      .filter((item) => item.text_type === 'announcement')
      .map((item) => ({
        id: item.id,
        title: item.title,
        message: item.body,
        type: item.announcement_type || 'info',
        date: item.date_label || '',
      }))

    const trivia = items
      .filter((item) => item.text_type === 'trivia')
      .map((item) => ({
        id: item.id,
        question: item.title,
        answer: item.body,
      }))

    return NextResponse.json({ announcements, trivia })
  } catch {
    return NextResponse.json({ announcements: [], trivia: [] }, { status: 200 })
  }
}
