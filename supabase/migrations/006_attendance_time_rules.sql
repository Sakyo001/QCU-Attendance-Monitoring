-- Migration: Add time-based attendance rules
-- Students marked 'late' after 30 minutes from class start_time
-- Attendance recording locked after 30 minutes

-- Add late_threshold_minutes to class_sessions (default 30 minutes)
ALTER TABLE public.class_sessions 
  ADD COLUMN IF NOT EXISTS late_threshold_minutes integer NOT NULL DEFAULT 30;

-- Add lock_after_minutes to class_sessions (default 30 minutes, same as late threshold)
ALTER TABLE public.class_sessions 
  ADD COLUMN IF NOT EXISTS lock_after_minutes integer NOT NULL DEFAULT 30;

-- Ensure attendance_records status can be 'late'
-- The status column is TEXT, so 'present', 'late', 'absent' are all valid

-- Add an index for faster attendance queries by date and section
CREATE INDEX IF NOT EXISTS idx_attendance_records_section_date 
  ON public.attendance_records (section_id, checked_in_at);

-- Add an index for faster class_sessions queries by day
CREATE INDEX IF NOT EXISTS idx_class_sessions_day 
  ON public.class_sessions (day_of_week, start_time);
