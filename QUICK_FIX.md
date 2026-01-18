# 🎯 Quick Reference - What's Missing & How to Fix

## The Error
```
Failed to load resource: the server responded with a status of 500
```

## The Cause
Two database tables are missing:
- ❌ `professor_face_registrations` 
- ❌ `attendance_sessions`

## The Fix (5 minutes)

### Table 1: Professor Face Registrations

**Where:** Supabase → SQL Editor

**SQL:**
```sql
CREATE TABLE IF NOT EXISTS professor_face_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    professor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    face_data TEXT NOT NULL,
    face_descriptor JSONB,
    image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(professor_id)
);

CREATE INDEX IF NOT EXISTS idx_professor_face_registrations_professor_id 
ON professor_face_registrations(professor_id);
```

### Table 2: Attendance Sessions

**SQL:**
```sql
CREATE TABLE IF NOT EXISTS attendance_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    professor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_date DATE NOT NULL,
    shift_opened_at TIMESTAMP WITH TIME ZONE,
    shift_closed_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(class_session_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_class_session_id 
ON attendance_sessions(class_session_id);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_professor_id 
ON attendance_sessions(professor_id);
```

## After Creating Tables

1. Restart your Next.js dev server: `npm run dev`
2. Refresh the browser
3. Try the facial registration again
4. Should now work! ✅

---

**Detailed guide:** See `DATABASE_TABLES_SETUP.md`
