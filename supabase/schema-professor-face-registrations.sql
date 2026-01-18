-- Migration: Create professor_face_registrations table
-- This table stores professor facial registration data including images and descriptors

CREATE TABLE IF NOT EXISTS professor_face_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    professor_id UUID NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    face_data LONGTEXT, -- Base64 encoded image data (stored temporarily or for backup)
    face_descriptor JSON, -- Face descriptor array (128-D float32 array from face-api.js)
    image_url TEXT, -- Public URL to the saved image file
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_active_professor UNIQUE (professor_id) DEFERRABLE INITIALLY DEFERRED
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_prof_face_registrations_professor_id 
    ON professor_face_registrations(professor_id);
CREATE INDEX IF NOT EXISTS idx_prof_face_registrations_is_active 
    ON professor_face_registrations(is_active);
CREATE INDEX IF NOT EXISTS idx_prof_face_registrations_created_at 
    ON professor_face_registrations(created_at);

-- Add comments for documentation
COMMENT ON TABLE professor_face_registrations 
    IS 'Stores professor facial registration data for liveness detection and attendance verification';
COMMENT ON COLUMN professor_face_registrations.face_data 
    IS 'Base64 encoded image data (full image stored locally in /public/face-registrations/)';
COMMENT ON COLUMN professor_face_registrations.face_descriptor 
    IS 'Face descriptor as JSON array (128-dimensional vector from face-api.js FaceRecognitionNet)';
COMMENT ON COLUMN professor_face_registrations.image_url 
    IS 'Public URL to the stored face image at /face-registrations/{professorId}-{imageId}.jpg';
COMMENT ON COLUMN professor_face_registrations.is_active 
    IS 'Whether this registration is currently active';

-- Create a view for easy access
CREATE OR REPLACE VIEW active_professor_face_registrations AS
SELECT 
    id,
    professor_id,
    first_name,
    last_name,
    image_url,
    created_at,
    updated_at
FROM professor_face_registrations
WHERE is_active = true;
