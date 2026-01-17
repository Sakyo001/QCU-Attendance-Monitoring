-- IT Program Attendance Monitoring System - SEED DATA
-- Insert test users for admin, professors, and students

-- ============================================
-- ADMIN USER
-- ============================================
INSERT INTO users (email, password, first_name, last_name, role, is_active)
VALUES (
  'admin@university.edu',
  'admin123',
  'Admin',
  'User',
  'admin',
  true
)
ON CONFLICT (email) DO UPDATE SET
  password = EXCLUDED.password,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active;

-- ============================================
-- PROFESSOR USERS
-- ============================================
INSERT INTO users (email, password, first_name, last_name, role, employee_id, is_active)
VALUES
(
  'prof.smith@university.edu',
  'smith123',
  'John',
  'Smith',
  'professor',
  'EMP001',
  true
),
(
  'prof.johnson@university.edu',
  'johnson123',
  'Jane',
  'Johnson',
  'professor',
  'EMP002',
  true
)
ON CONFLICT (email) DO UPDATE SET
  password = EXCLUDED.password,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active;

-- ============================================
-- STUDENT USERS
-- ============================================
INSERT INTO users (email, password, first_name, last_name, role, student_id, is_active)
VALUES
(
  'student1@university.edu',
  'student123',
  'Alice',
  'Brown',
  'student',
  'STU001',
  true
),
(
  'student2@university.edu',
  'student123',
  'Bob',
  'Davis',
  'student',
  'STU002',
  true
)
ON CONFLICT (email) DO UPDATE SET
  password = EXCLUDED.password,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active;

-- ============================================
-- TEST ACCOUNTS CREATED
-- ============================================
-- Admin:     admin@university.edu / admin123
-- Professor: prof.smith@university.edu / smith123
-- Professor: prof.johnson@university.edu / johnson123
-- Student:   student1@university.edu / student123
-- Student:   student2@university.edu / student123
