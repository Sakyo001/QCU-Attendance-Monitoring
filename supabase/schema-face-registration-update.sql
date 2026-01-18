-- Migration: Add image_url to facial_recognition_data table
-- This adds support for storing face registration images

-- Add image_url column if it doesn't exist
ALTER TABLE facial_recognition_data
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS registration_status VARCHAR(20) DEFAULT 'completed';

-- Add comment
COMMENT ON COLUMN facial_recognition_data.image_url IS 'URL to the stored face registration image';
COMMENT ON COLUMN facial_recognition_data.registration_status IS 'Status of face registration (pending, completed, failed)';
