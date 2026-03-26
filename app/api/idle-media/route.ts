import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/service-role'

export async function GET() {
  try {
    const supabase = createServiceRoleClient()

    const { data, error } = await (supabase as any)
      .from('idle_media')
      .select('id, title, media_type, media_url, display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ items: [] }, { status: 200 })
    }

    return NextResponse.json({ items: data || [] })
  } catch {
    return NextResponse.json({ items: [] }, { status: 200 })
  }
}
