-- Add subject_code and subject_name columns to class_sessions table
-- These store the subject from the uploaded class list Excel file
ALTER TABLE public.class_sessions
ADD COLUMN IF NOT EXISTS subject_code character varying,
ADD COLUMN IF NOT EXISTS subject_name text;
