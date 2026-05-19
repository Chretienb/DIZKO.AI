CREATE OR REPLACE FUNCTION increment_storage(user_id uuid, bytes bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles
  SET storage_used_bytes = GREATEST(0, storage_used_bytes + bytes)
  WHERE id = user_id;
END;
$$;

CREATE OR REPLACE FUNCTION decrement_storage(user_id uuid, bytes bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles
  SET storage_used_bytes = GREATEST(0, storage_used_bytes - bytes)
  WHERE id = user_id;
END;
$$;
