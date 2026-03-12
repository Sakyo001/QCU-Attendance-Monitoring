-- Make email optional on the users table so faculty can be registered without an email
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
