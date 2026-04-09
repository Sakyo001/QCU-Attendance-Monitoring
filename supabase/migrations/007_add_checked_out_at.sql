-- Add optional time-out timestamp for kiosk check-out flow
ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS checked_out_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_attendance_records_checked_out_at
  ON public.attendance_records (checked_out_at);