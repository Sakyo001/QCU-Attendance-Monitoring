-- Add middle_name column to users table

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS middle_name VARCHAR(50);

-- Create an index on student_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_student_id ON users(student_id);

