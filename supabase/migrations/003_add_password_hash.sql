-- Add password_hash column to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS password_hash character varying;

-- Migration note: Run this to hash existing passwords (in application code):
-- 1. Fetch all users with plain text passwords
-- 2. Use bcryptjs to hash each password
-- 3. Update password_hash column
-- 4. Clear the plain text password column

-- After migration, new passwords should always be hashed before storing
