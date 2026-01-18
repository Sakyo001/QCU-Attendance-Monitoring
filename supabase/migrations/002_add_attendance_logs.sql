-- Create attendance logs table for shift tracking

CREATE TABLE IF NOT EXISTS attendance_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('shift_open', 'shift_close')),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  professor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_attendance_logs_session_id ON attendance_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_event_type ON attendance_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_timestamp ON attendance_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_professor_id ON attendance_logs(professor_id);
