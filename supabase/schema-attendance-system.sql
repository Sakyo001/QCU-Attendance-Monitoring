-- Attendance System Schema with Facial Recognition
-- This schema supports professor facial registration and shift-based student attendance

-- Table: professor_face_registrations
-- Stores professor facial recognition data
CREATE TABLE IF NOT EXISTS professor_face_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    professor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    face_data TEXT NOT NULL, -- Base64 encoded face data or URL to stored image
    face_descriptor JSONB, -- Face recognition descriptor (embedding vector)
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(professor_id)
);

-- Table: student_face_registrations
-- Stores student facial recognition data
CREATE TABLE IF NOT EXISTS student_face_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_number TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    face_data TEXT NOT NULL, -- Base64 encoded face data or URL to stored image
    face_descriptor JSONB, -- Face recognition descriptor (embedding vector)
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT true
);

-- Table: attendance_sessions
-- Tracks open/close shifts for each class session
CREATE TABLE IF NOT EXISTS attendance_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_session_id UUID NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    professor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_date DATE NOT NULL DEFAULT CURRENT_DATE,
    shift_opened_at TIMESTAMPTZ,
    shift_closed_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT false, -- true when shift is open
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_active_session UNIQUE(class_session_id, session_date)
);

-- Table: attendance_records
-- Stores individual student attendance records
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance_session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_registration_id UUID NOT NULL REFERENCES student_face_registrations(id) ON DELETE CASCADE,
    student_number TEXT NOT NULL,
    checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    face_match_confidence DECIMAL(5,2), -- Confidence score (0-100) of facial recognition match
    status TEXT NOT NULL DEFAULT 'present', -- present, late, excused
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_student_attendance UNIQUE(attendance_session_id, student_number)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_professor_face_reg_professor ON professor_face_registrations(professor_id);
CREATE INDEX IF NOT EXISTS idx_student_face_reg_student_number ON student_face_registrations(student_number);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_class ON attendance_sessions(class_session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date ON attendance_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_active ON attendance_sessions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_attendance_records_session ON attendance_records(attendance_session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student ON attendance_records(student_number);

-- Trigger: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_professor_face_registrations_updated_at
    BEFORE UPDATE ON professor_face_registrations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_student_face_registrations_updated_at
    BEFORE UPDATE ON student_face_registrations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attendance_sessions_updated_at
    BEFORE UPDATE ON attendance_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE professor_face_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_face_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- Professor can manage their own face registration
CREATE POLICY professor_face_own_data ON professor_face_registrations
    FOR ALL USING (professor_id = auth.uid());

-- Students can manage their own face registration
CREATE POLICY student_face_own_data ON student_face_registrations
    FOR ALL USING (student_number IN (
        SELECT employee_id FROM users WHERE id = auth.uid()
    ));

-- Professors can manage attendance sessions for their classes
CREATE POLICY professor_attendance_sessions ON attendance_sessions
    FOR ALL USING (professor_id = auth.uid());

-- Students can view attendance records during active sessions
CREATE POLICY student_view_active_attendance ON attendance_records
    FOR SELECT USING (
        attendance_session_id IN (
            SELECT id FROM attendance_sessions WHERE is_active = true
        )
    );

-- Students can insert their own attendance during active sessions
CREATE POLICY student_mark_attendance ON attendance_records
    FOR INSERT WITH CHECK (
        student_number IN (
            SELECT employee_id FROM users WHERE id = auth.uid()
        ) AND
        attendance_session_id IN (
            SELECT id FROM attendance_sessions WHERE is_active = true
        )
    );

-- Comments
COMMENT ON TABLE professor_face_registrations IS 'Stores professor facial recognition data for attendance system';
COMMENT ON TABLE student_face_registrations IS 'Stores student facial recognition data for attendance marking';
COMMENT ON TABLE attendance_sessions IS 'Tracks open/close shifts for class sessions, controlled by professors';
COMMENT ON TABLE attendance_records IS 'Individual student attendance records linked to active sessions';
COMMENT ON COLUMN attendance_sessions.is_active IS 'true = shift is open and students can mark attendance, false = shift is closed';
COMMENT ON COLUMN attendance_records.face_match_confidence IS 'Confidence score (0-100) from facial recognition matching';
