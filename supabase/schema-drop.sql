-- IT Program Attendance Monitoring System - DROP OLD SCHEMA
-- Run this FIRST to clean up all old tables and objects

-- ============================================
-- DROP FUNCTIONS & TRIGGERS FIRST
-- ============================================

DROP TRIGGER IF EXISTS update_users_updated_at ON users CASCADE;
DROP TRIGGER IF EXISTS update_sections_updated_at ON sections CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- ============================================
-- DROP TABLES (CASCADE removes dependent objects)
-- ============================================

DROP TABLE IF EXISTS attendance_records CASCADE;
DROP TABLE IF EXISTS enrollments CASCADE;
DROP TABLE IF EXISTS section_schedules CASCADE;
DROP TABLE IF EXISTS sections CASCADE;
DROP TABLE IF EXISTS courses CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================
-- DROP ENUMS
-- ============================================

DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS attendance_status CASCADE;
DROP TYPE IF EXISTS day_of_week CASCADE;

-- ============================================
-- CLEANUP COMPLETE
-- ============================================
-- Now run schema-simplified.sql to create the new schema
