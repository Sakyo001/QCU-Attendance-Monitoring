# Vercel Deployment Guide

## Steps to Deploy to Vercel

### 1. Push to Git

First, commit and push your changes to your GitHub repository:

```bash
git add .
git commit -m "Fix Vercel deployment: lazy-load Supabase clients"
git push origin main
```

### 2. Connect to Vercel

Go to https://vercel.com and sign in with your GitHub account.

1. Click **"New Project"** or **"Add New..."**
2. Select your GitHub repository (`attendance-monitoring`)
3. Vercel will automatically detect it's a Next.js project
4. Click **"Deploy"** (you can set environment variables before or after)

### 3. Set Environment Variables in Vercel

**Important:** You must add environment variables for the app to work properly.

#### In Vercel Dashboard:

1. Go to your project settings
2. Navigate to **Settings → Environment Variables**
3. Add the following variables:

| Variable Name | Value | Source |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://bzbwpnahykgajlgnipdw.supabase.co` | From your `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your anon key | From your `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service role key | From your `.env.local` |
| `NEXT_PUBLIC_APP_URL` | `https://your-vercel-domain.vercel.app` | Set after first deploy |
| `NODE_ENV` | `production` | Default |

4. Click **"Save"** for each variable
5. Redeploy the project (Vercel will automatically redeploy when env vars change)

### 4. Verify Deployment

Once deployed:

1. Visit your Vercel URL
2. Test the login page
3. Test student/professor/admin registration flows
4. Check browser console for any errors

## Environment Variables Reference

From your `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=https://bzbwpnahykgajlgnipdw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

⚠️ **Never commit secrets to Git. Use Vercel's environment variable management.**

## Important Changes Made for Vercel Compatibility

### Problem
API routes were initializing Supabase clients at module load time:
```typescript
// ❌ BROKEN - Fails during Vercel build
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

### Solution
Moved client initialization inside route handlers (lazy loading):
```typescript
// ✅ FIXED - Works during Vercel build
export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin()  // Called at runtime, not build time
  ...
}
```

Created a helper function at `utils/supabase/admin.ts`:
```typescript
export function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('supabaseUrl is required...')
  }
  if (!supabaseServiceKey) {
    throw new Error('supabaseServiceKey is required...')
  }

  return createClient<Database>(supabaseUrl, supabaseServiceKey) as any
}
```

## Troubleshooting

### Build fails with "supabaseUrl is required"
- Check that all environment variables are set in Vercel
- Verify variable names match exactly (case-sensitive)
- Redeploy after adding/updating variables

### API routes return 500 errors
- Check Vercel function logs: **Settings → Functions**
- Ensure Supabase is accessible from Vercel's servers
- Verify `SUPABASE_SERVICE_ROLE_KEY` is correct

### Face registration not working
- Ensure CORS is configured in Supabase
- Check browser console for CORS errors
- Verify S3 bucket credentials if using image storage

## Production Checklist

- [ ] Environment variables set in Vercel
- [ ] Build succeeds with `npm run build`
- [ ] All API routes respond without errors
- [ ] Student/Professor/Admin registration workflows tested
- [ ] Face detection working correctly
- [ ] Database queries executing properly
- [ ] No console errors in browser

## Rolling Back

If something goes wrong:
1. In Vercel dashboard, go to **Deployments**
2. Find the previous working deployment
3. Click **...** → **Promote to Production**

## Need Help?

- Vercel Docs: https://vercel.com/docs
- Next.js Docs: https://nextjs.org/docs
- Supabase Docs: https://supabase.com/docs
