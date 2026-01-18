# 🔧 Database Tables Setup - REQUIRED

You're getting 500 errors because there are **two critical tables missing** from your Supabase database.

## ⚠️ Missing Tables

1. **`professor_face_registrations`** - For storing face registration data
2. **`attendance_sessions`** - For managing attendance session state

## 🚀 Quick Fix - Execute Both SQL Scripts

### Step 1: Log Into Supabase
1. Go to **https://app.supabase.com**
2. Select your project
3. Click **SQL Editor** in the left sidebar

### Step 2: Execute First Migration - Face Registrations

Copy and paste this SQL into the editor:

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

**Click Run** ✓

### Step 3: Execute Second Migration - Attendance Sessions

Paste this SQL into a new query:

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

**Click Run** ✓

## ✅ Verification

After running both scripts:

1. Go to **Database → Tables** in Supabase
2. Verify you see both:
   - ✅ `professor_face_registrations`
   - ✅ `attendance_sessions`

## 🔄 After Setup

1. **Restart** your Next.js dev server
2. **Try the full flow again**:
   - Go to professor attendance page
   - Complete facial registration
   - You should now see the attendance controls

## 📋 Files with SQL Code

- **Face Registrations:** `supabase/create-professor-face-registrations-table.sql`
- **Attendance Sessions:** `supabase/create-attendance-sessions-table.sql`

---

**⏱️ Estimated Time: 3-5 minutes**

Let me know once you've created both tables and we can test the complete flow!
