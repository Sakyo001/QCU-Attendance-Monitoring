-- Migration: Add image_url to professor_face_registrations table
-- This adds support for storing face registration image URLs

-- Check if professor_face_registrations table exists and add image_url column if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'professor_face_registrations'
  ) THEN
    -- Add image_url column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'professor_face_registrations' 
      AND column_name = 'image_url'
    ) THEN
      ALTER TABLE professor_face_registrations
      ADD COLUMN image_url TEXT;
    END IF;
  END IF;
END
$$;
