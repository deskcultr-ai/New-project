-- 20260721000014 used `create or replace function post_message(...)` with a
-- new 4th parameter, which in Postgres creates a second overload rather
-- than replacing the 3-arg version (function identity includes the
-- parameter list). PostgREST then couldn't disambiguate a call carrying
-- only p_conversation_id/p_body against either signature (both have
-- defaults for the rest), breaking every message send, not just replies.
-- Drop the old 3-arg signature so only the 4-arg one remains.

drop function if exists public.post_message(uuid, text, uuid[]);
