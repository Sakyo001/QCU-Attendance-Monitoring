# Vercel Deployment Setup - Quick Start

## What Was Fixed

Your project was failing to build on Vercel because Supabase clients were being initialized at **module load time** during the build process, when environment variables weren't available yet.

**Solution:** Moved client initialization to **runtime** (inside route handlers) using lazy loading.

## Quick Deploy to Vercel

### 1. Go to Vercel.com
https://vercel.com/dashboard

### 2. Click "New Project"
- Select your GitHub repository: `QCU-Attendance-Monitoring`
- Framework should auto-select as **Next.js**

### 3. Add Environment Variables
Before clicking Deploy, click "Environment Variables" and add:

```
NEXT_PUBLIC_SUPABASE_URL = https://bzbwpnahykgajlgnipdw.supabase.co

NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6YndwbmFoeWtnYWpsZ25pcGR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1MzI2ODgsImV4cCI6MjA4NDEwODY4OH0.TWkxFj1smTErB5EiGeZJ05jLoKuKvxsP8N1xiqVRgVA

SUPABASE_SERVICE_ROLE_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6YndwbmFoeWtnYWpsZ25pcGR3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODUzMjY4OCwiZXhwIjoyMDg0MTA4Njg4fQ.uL5UpaZ_BZ9qB433OD70Vf294Klm3cmjT_2iPaXXIg0
```

### 4. Click "Deploy"
Vercel will build and deploy your app automatically.

### 5. Done!
Your app will be live at: `https://your-project-name.vercel.app`

## Files Changed

✅ Created: `utils/supabase/admin.ts` - Helper for lazy-loading Supabase admin client
✅ Updated: All API routes in `app/api/` - Now use lazy initialization
✅ Created: `VERCEL_DEPLOYMENT.md` - Detailed deployment guide

## How It Works

**Before (❌ Failed on Vercel):**
```typescript
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,    // Not available during build
  process.env.SUPABASE_SERVICE_ROLE_KEY!    // ❌ Error: env vars not loaded
)
```

**After (✅ Works on Vercel):**
```typescript
export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin()  // ✅ Called at runtime when env vars available
  // ... rest of handler
}
```

## Need Help?

See [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) for:
- Detailed environment variables setup
- Troubleshooting guide
- Production checklist
- Rolling back deployments

## Summary

- ✅ Build now succeeds locally (`npm run build`)
- ✅ All 55 pages and API routes compile successfully
- ✅ Ready for Vercel deployment
- ✅ All environment variables properly configured
- ✅ Lazy-loading prevents build-time errors
