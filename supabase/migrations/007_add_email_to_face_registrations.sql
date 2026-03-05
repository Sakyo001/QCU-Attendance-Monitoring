-- Add email column to student_face_registrations table
-- This stores the MS365 email from the uploaded class list Excel file
ALTER TABLE public.student_face_registrations
ADD COLUMN IF NOT EXISTS email character varying;

-- Backfill email from users table where student numbers match
UPDATE public.student_face_registrations sfr
SET email = u.email
FROM public.users u
WHERE sfr.student_number = u.student_id
  AND sfr.email IS NULL
  AND u.email IS NOT NULL;
