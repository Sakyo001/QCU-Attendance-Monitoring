-- Add middle_name column to student_face_registrations table
ALTER TABLE public.student_face_registrations
ADD COLUMN IF NOT EXISTS middle_name character varying;
