-- SQL Script to Reset Database (Keep Users Table Only)
-- This script drops all tables except the users table
-- WARNING: This will delete all data except user accounts

-- Drop all tables with CASCADE to handle foreign key dependencies
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;
DROP TABLE IF EXISTS attendance_records CASCADE;
DROP TABLE IF EXISTS enrollments CASCADE;
DROP TABLE IF EXISTS section_schedules CASCADE;
DROP TABLE IF EXISTS sections CASCADE;
DROP TABLE IF EXISTS courses CASCADE;
DROP TABLE IF EXISTS academic_years CASCADE;
DROP TABLE IF EXISTS facial_recognition_data CASCADE;
DROP TABLE IF EXISTS departments CASCADE;

-- Keep the users table intact
-- ALTER TABLE users (if needed for any cleanup operations)

-- Optional: Drop and recreate ENUM types if you want to reset them
-- Be careful with this as users table may depend on these
-- DROP TYPE IF EXISTS user_role CASCADE;
-- DROP TYPE IF EXISTS attendance_status CASCADE;
-- DROP TYPE IF EXISTS semester_term CASCADE;
-- DROP TYPE IF EXISTS day_of_week CASCADE;
