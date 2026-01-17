-- SQL Schema for Faculty and Sections Management
-- Run this after the users table exists

-- Sections Table
CREATE TABLE IF NOT EXISTS sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_code VARCHAR(10) NOT NULL,
    course_id UUID,
    semester VARCHAR(20) NOT NULL,
    academic_year VARCHAR(20),
    max_students INTEGER DEFAULT 40,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Section Professors Assignment Table (Many-to-Many)
CREATE TABLE IF NOT EXISTS section_professors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    professor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(section_id, professor_id)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_sections_semester ON sections(semester);
CREATE INDEX IF NOT EXISTS idx_sections_academic_year ON sections(academic_year);
CREATE INDEX IF NOT EXISTS idx_section_professors_section ON section_professors(section_id);
CREATE INDEX IF NOT EXISTS idx_section_professors_professor ON section_professors(professor_id);

-- Enable Row Level Security (optional - disable if you're using service role)
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE section_professors ENABLE ROW LEVEL SECURITY;

-- RLS Policies (Allow all for service role, customize as needed)
CREATE POLICY "Allow all operations on sections" ON sections FOR ALL USING (true);
CREATE POLICY "Allow all operations on section_professors" ON section_professors FOR ALL USING (true);

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add trigger to sections table
DROP TRIGGER IF EXISTS update_sections_updated_at ON sections;
CREATE TRIGGER update_sections_updated_at
    BEFORE UPDATE ON sections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
