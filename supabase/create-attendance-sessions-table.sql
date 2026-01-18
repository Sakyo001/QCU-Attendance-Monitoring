-- Create attendance_sessions table for managing professor attendance sessions
-- This table tracks when professors open/close attendance for a class session

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

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_class_session_id 
ON attendance_sessions(class_session_id);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_professor_id 
ON attendance_sessions(professor_id);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date 
ON attendance_sessions(session_date);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_is_active 
ON attendance_sessions(is_active);

-- Add comments
COMMENT ON TABLE attendance_sessions IS 'Tracks attendance sessions when professors open/close attendance marking for their classes';
COMMENT ON COLUMN attendance_sessions.class_session_id IS 'Reference to the class session';
COMMENT ON COLUMN attendance_sessions.professor_id IS 'Professor conducting the attendance session';
COMMENT ON COLUMN attendance_sessions.session_date IS 'Date of the attendance session';
COMMENT ON COLUMN attendance_sessions.shift_opened_at IS 'Timestamp when professor opened the attendance session';
COMMENT ON COLUMN attendance_sessions.shift_closed_at IS 'Timestamp when professor closed the attendance session';
COMMENT ON COLUMN attendance_sessions.is_active IS 'Whether the session is currently open for attendance marking';
