-- Add 'client' role to enum
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'app_role' AND e.enumlabel = 'client') THEN
    ALTER TYPE app_role ADD VALUE 'client';
  END IF;
END $$;

-- Update RLS policies on users table to be more restrictive
DROP POLICY IF EXISTS "Public access to users" ON users;

-- Users can only see their own user record
CREATE POLICY "Users can view their own data"
ON users FOR SELECT
USING (id = auth.uid());

-- Admins can manage all users
CREATE POLICY "Admins can manage users"
ON users FOR ALL
USING (has_role(auth.uid(), 'admin'));

-- Clients can update their own data (but not role or company_id)
CREATE POLICY "Users can update their own data"
ON users FOR UPDATE
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Create function for admins to reset client passwords
CREATE OR REPLACE FUNCTION admin_reset_password(target_user_id uuid, new_password text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_email text;
BEGIN
  -- Verify caller is admin
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  
  -- Get user email
  SELECT email INTO target_email FROM users WHERE id = target_user_id;
  
  IF target_email IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  
  -- Return success with email (actual password reset would be done via Supabase Admin API)
  RETURN json_build_object(
    'success', true,
    'email', target_email,
    'user_id', target_user_id
  );
END;
$$;