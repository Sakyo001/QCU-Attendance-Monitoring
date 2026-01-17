-- Attendance Monitoring System Database Schema
-- Supabase PostgreSQL Schema

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- ENUMS
-- ============================================

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('student', 'professor', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'excused');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE semester_term AS ENUM ('fall', 'spring', 'summer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE day_of_week AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- CORE TABLES
-- ============================================

-- Departments Table
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    code VARCHAR(10) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Users Table (Students, Professors, Admins)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    student_id VARCHAR(20) UNIQUE,
    employee_id VARCHAR(20) UNIQUE,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    phone VARCHAR(20),
    profile_picture_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE,
    CONSTRAINT check_role_id CHECK (
        (role = 'student' AND student_id IS NOT NULL) OR
        (role IN ('professor', 'admin') AND employee_id IS NOT NULL)
    )
);

-- Facial Recognition Data
CREATE TABLE IF NOT EXISTS facial_recognition_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    face_encoding BYTEA NOT NULL,
    encoding_version VARCHAR(10) DEFAULT 'v1.0',
    confidence_score DECIMAL(5,4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    UNIQUE(user_id, is_active)
);

-- Academic Years
CREATE TABLE IF NOT EXISTS academic_years (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    year_label VARCHAR(20) NOT NULL UNIQUE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date > start_date)
);

-- Courses
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    credits INTEGER DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(department_id, code)
);

-- Sections (Class sections with specific professors and schedule)
CREATE TABLE IF NOT EXISTS sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    section_code VARCHAR(10) NOT NULL,
    section_name VARCHAR(100) NOT NULL,
    professor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    adviser_id UUID REFERENCES users(id) ON DELETE SET NULL,
    term semester_term NOT NULL,
    room VARCHAR(50),
    max_students INTEGER DEFAULT 50,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(course_id, academic_year_id, section_code, term)
);

-- Section Schedule (Meeting times for each section)
CREATE TABLE IF NOT EXISTS section_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    day_of_week day_of_week NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_time > start_time),
    UNIQUE(section_id, day_of_week, start_time)
);

-- Student Enrollments
CREATE TABLE IF NOT EXISTS enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    dropped_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    final_grade VARCHAR(5),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, section_id)
);

-- Attendance Records
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    status attendance_status NOT NULL DEFAULT 'absent',
    time_recorded TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    location VARCHAR(100),
    verification_method VARCHAR(20) DEFAULT 'facial_recognition',
    confidence_score DECIMAL(5,4),
    notes TEXT,
    marked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, section_id, date)
);

-- System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    setting_key VARCHAR(50) NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    table_name VARCHAR(50),
    record_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES
-- ============================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_student_id ON users(student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- Attendance records indexes
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_section ON attendance_records(section_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_records(status);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_records(student_id, date);

-- Sections indexes
CREATE INDEX IF NOT EXISTS idx_sections_course ON sections(course_id);
CREATE INDEX IF NOT EXISTS idx_sections_professor ON sections(professor_id);
CREATE INDEX IF NOT EXISTS idx_sections_adviser ON sections(adviser_id);
CREATE INDEX IF NOT EXISTS idx_sections_academic_year ON sections(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_sections_term ON sections(term);

-- Enrollments indexes
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_section ON enrollments(section_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_active ON enrollments(is_active);

-- Facial recognition indexes
CREATE INDEX IF NOT EXISTS idx_facial_user ON facial_recognition_data(user_id);
CREATE INDEX IF NOT EXISTS idx_facial_active ON facial_recognition_data(is_active);

-- Schedule indexes
CREATE INDEX IF NOT EXISTS idx_schedule_section ON section_schedules(section_id);
CREATE INDEX IF NOT EXISTS idx_schedule_day ON section_schedules(day_of_week);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to tables
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_departments_updated_at ON departments;
CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_courses_updated_at ON courses;
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_sections_updated_at ON sections;
CREATE TRIGGER update_sections_updated_at BEFORE UPDATE ON sections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_attendance_updated_at ON attendance_records;
CREATE TRIGGER update_attendance_updated_at BEFORE UPDATE ON attendance_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_facial_updated_at ON facial_recognition_data;
CREATE TRIGGER update_facial_updated_at BEFORE UPDATE ON facial_recognition_data
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate attendance percentage
CREATE OR REPLACE FUNCTION get_student_attendance_percentage(
    p_student_id UUID,
    p_section_id UUID DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS DECIMAL(5,2) AS $$
DECLARE
    total_days INTEGER;
    present_days INTEGER;
BEGIN
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status IN ('present', 'late'))
    INTO total_days, present_days
    FROM attendance_records
    WHERE student_id = p_student_id
        AND (p_section_id IS NULL OR section_id = p_section_id)
        AND (p_start_date IS NULL OR date >= p_start_date)
        AND (p_end_date IS NULL OR date <= p_end_date);
    
    IF total_days = 0 THEN
        RETURN 0;
    END IF;
    
    RETURN ROUND((present_days::DECIMAL / total_days::DECIMAL) * 100, 2);
END;
$$ LANGUAGE plpgsql;

-- Function to get section attendance summary
CREATE OR REPLACE FUNCTION get_section_attendance_summary(
    p_section_id UUID,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    total_students BIGINT,
    present_count BIGINT,
    absent_count BIGINT,
    late_count BIGINT,
    attendance_rate DECIMAL(5,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT e.student_id)::BIGINT,
        COUNT(DISTINCT CASE WHEN ar.status = 'present' THEN e.student_id END)::BIGINT,
        COUNT(DISTINCT CASE WHEN ar.status = 'absent' OR ar.id IS NULL THEN e.student_id END)::BIGINT,
        COUNT(DISTINCT CASE WHEN ar.status = 'late' THEN e.student_id END)::BIGINT,
        ROUND(
            (COUNT(DISTINCT CASE WHEN ar.status IN ('present', 'late') THEN e.student_id END)::DECIMAL / 
             NULLIF(COUNT(DISTINCT e.student_id)::DECIMAL, 0)) * 100, 2
        )
    FROM enrollments e
    LEFT JOIN attendance_records ar ON e.student_id = ar.student_id 
        AND e.section_id = ar.section_id 
        AND ar.date = p_date
    WHERE e.section_id = p_section_id AND e.is_active = true;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE section_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE facial_recognition_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Users policies - single permissive policy for authenticated users
DROP POLICY IF EXISTS "Users can view their own profile" ON users;
DROP POLICY IF EXISTS "Authenticated users can view public profiles" ON users;
DROP POLICY IF EXISTS "Users can update their own profile" ON users;

CREATE POLICY "authenticated_users_can_read_users" ON users
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "users_can_update_own_profile" ON users
    FOR UPDATE USING (auth.uid() = auth_id)
    WITH CHECK (auth.uid() = auth_id);

-- Sections policies
DROP POLICY IF EXISTS "Authenticated users can read sections" ON sections;
DROP POLICY IF EXISTS "Professors can read their assigned sections" ON sections;

CREATE POLICY "authenticated_users_can_read_sections" ON sections
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "professors_can_insert_sections" ON sections
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "professors_can_update_sections" ON sections
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Section Schedules policies
DROP POLICY IF EXISTS "Authenticated users can read section schedules" ON section_schedules;

CREATE POLICY "authenticated_users_can_read_schedules" ON section_schedules
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- Enrollments policies
DROP POLICY IF EXISTS "Authenticated users can read enrollments" ON enrollments;

CREATE POLICY "authenticated_users_can_read_enrollments" ON enrollments
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- Courses policies
DROP POLICY IF EXISTS "Authenticated users can read courses" ON courses;

CREATE POLICY "authenticated_users_can_read_courses" ON courses
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- Attendance policies
DROP POLICY IF EXISTS "Students can view their own attendance" ON attendance_records;
DROP POLICY IF EXISTS "Professors can view attendance for their sections" ON attendance_records;
DROP POLICY IF EXISTS "Authenticated users can view attendance" ON attendance_records;
DROP POLICY IF EXISTS "Users can insert attendance records" ON attendance_records;

CREATE POLICY "authenticated_users_can_read_attendance" ON attendance_records
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "authenticated_users_can_insert_attendance" ON attendance_records
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- VIEWS FOR COMMON QUERIES
-- ============================================

-- Student attendance summary view
CREATE OR REPLACE VIEW student_attendance_summary AS
SELECT 
    u.id AS student_id,
    u.first_name,
    u.last_name,
    u.student_id AS student_number,
    s.id AS section_id,
    s.section_name,
    c.name AS course_name,
    COUNT(ar.id) AS total_classes,
    COUNT(ar.id) FILTER (WHERE ar.status = 'present') AS present_count,
    COUNT(ar.id) FILTER (WHERE ar.status = 'absent') AS absent_count,
    COUNT(ar.id) FILTER (WHERE ar.status = 'late') AS late_count,
    ROUND(
        (COUNT(ar.id) FILTER (WHERE ar.status IN ('present', 'late'))::DECIMAL / 
         NULLIF(COUNT(ar.id)::DECIMAL, 0)) * 100, 2
    ) AS attendance_percentage
FROM users u
JOIN enrollments e ON u.id = e.student_id AND e.is_active = true
JOIN sections s ON e.section_id = s.id
JOIN courses c ON s.course_id = c.id
LEFT JOIN attendance_records ar ON u.id = ar.student_id AND s.id = ar.section_id
WHERE u.role = 'student'
GROUP BY u.id, u.first_name, u.last_name, u.student_id, s.id, s.section_name, c.name;

-- Professor sections view
CREATE OR REPLACE VIEW professor_sections_view AS
SELECT 
    s.id AS section_id,
    s.section_code,
    s.section_name,
    c.code AS course_code,
    c.name AS course_name,
    u.id AS professor_id,
    u.first_name AS professor_first_name,
    u.last_name AS professor_last_name,
    s.term,
    s.room,
    ay.year_label,
    COUNT(DISTINCT e.student_id) AS enrolled_students
FROM sections s
JOIN courses c ON s.course_id = c.id
LEFT JOIN users u ON s.professor_id = u.id
JOIN academic_years ay ON s.academic_year_id = ay.id
LEFT JOIN enrollments e ON s.id = e.section_id AND e.is_active = true
GROUP BY s.id, s.section_code, s.section_name, c.code, c.name, 
         u.id, u.first_name, u.last_name, s.term, s.room, ay.year_label;

-- ============================================
-- SAMPLE DATA INSERTION
-- ============================================

-- Insert default system settings (idempotent)
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('system_enabled', 'true', 'Enable or disable system access'),
('late_attendance_allowed', 'true', 'Allow students to mark attendance after scheduled time'),
('late_attendance_cutoff', '15', 'Minutes after class start to allow late attendance'),
('facial_recognition_threshold', '0.85', 'Minimum confidence score for facial recognition'),
('attendance_required_percentage', '80', 'Minimum attendance percentage required')
ON CONFLICT (setting_key) DO NOTHING;

-- Insert default academic year (idempotent)
INSERT INTO academic_years (year_label, start_date, end_date, is_current) VALUES
('2025-2026', '2025-08-01', '2026-05-31', true)
ON CONFLICT (year_label) DO NOTHING;

-- Insert sample departments (idempotent)
INSERT INTO departments (name, code, description) VALUES
('Computer Science', 'CS', 'Department of Computer Science'),
('Information Technology', 'IT', 'Department of Information Technology'),
('Engineering', 'ENG', 'Department of Engineering'),
('Business Administration', 'BA', 'Department of Business Administration')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE users IS 'Stores all system users: students, professors, and admins';
COMMENT ON TABLE attendance_records IS 'Records of student attendance with facial recognition verification';
COMMENT ON TABLE sections IS 'Class sections with professor assignments and schedules';
COMMENT ON TABLE facial_recognition_data IS 'Encrypted facial encodings for biometric authentication';
