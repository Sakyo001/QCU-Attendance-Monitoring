import { createClient } from '@supabase/supabase-js'
import { Database } from '@/types/database.types'

/**
 * Creates a Supabase admin client for server-side operations.
 * This function should only be called inside route handlers, not at module level.
 * Returns a typed client cast to any to avoid TypeScript inference issues.
 */
export function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('supabaseUrl is required. Set NEXT_PUBLIC_SUPABASE_URL in environment variables.')
  }

  if (!supabaseServiceKey) {
    throw new Error('supabaseServiceKey is required. Set SUPABASE_SERVICE_ROLE_KEY in environment variables.')
  }

  return createClient<Database>(supabaseUrl, supabaseServiceKey) as any
}
