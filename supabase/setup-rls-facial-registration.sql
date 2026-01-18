-- ============================================
-- ROW LEVEL SECURITY (RLS) FOR FACIAL REGISTRATION
-- ============================================

-- Enable RLS on professor_face_registrations table
ALTER TABLE professor_face_registrations ENABLE ROW LEVEL SECURITY;

-- Policy: Allow professors to INSERT their own facial registration
CREATE POLICY "professors_can_insert_own_facial_registration" 
ON professor_face_registrations 
FOR INSERT 
WITH CHECK (professor_id = auth.uid());

-- Policy: Allow professors to SELECT their own facial registration
CREATE POLICY "professors_can_select_own_facial_registration" 
ON professor_face_registrations 
FOR SELECT 
USING (professor_id = auth.uid());

-- Policy: Allow professors to UPDATE their own facial registration
CREATE POLICY "professors_can_update_own_facial_registration" 
ON professor_face_registrations 
FOR UPDATE 
USING (professor_id = auth.uid())
WITH CHECK (professor_id = auth.uid());

-- Policy: Allow professors to DELETE their own facial registration
CREATE POLICY "professors_can_delete_own_facial_registration" 
ON professor_face_registrations 
FOR DELETE 
USING (professor_id = auth.uid());

-- ============================================
-- ROW LEVEL SECURITY (RLS) FOR ATTENDANCE SESSIONS
-- ============================================

-- Enable RLS on attendance_sessions table
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Allow professors to INSERT attendance sessions for their classes
CREATE POLICY "professors_can_insert_attendance_sessions" 
ON attendance_sessions 
FOR INSERT 
WITH CHECK (professor_id = auth.uid());

-- Policy: Allow professors to SELECT their own attendance sessions
CREATE POLICY "professors_can_select_attendance_sessions" 
ON attendance_sessions 
FOR SELECT 
USING (professor_id = auth.uid());

-- Policy: Allow professors to UPDATE their own attendance sessions
CREATE POLICY "professors_can_update_attendance_sessions" 
ON attendance_sessions 
FOR UPDATE 
USING (professor_id = auth.uid())
WITH CHECK (professor_id = auth.uid());
