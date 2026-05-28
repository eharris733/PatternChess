-- Wipe ALL progress for one user, returning the account to first-run
-- (onboarding) state. Supabase project: ydfwppthwnlgxnntzrvg
--
-- IRREVERSIBLE. Deletes games, blunders, training sessions, and annotations,
-- and clears linked accounts + streaks on the profile. SR cycle state,
-- session history, and streaks cannot be recovered.
--
-- Run in: Supabase dashboard -> SQL Editor (runs as owner, bypasses RLS).

do $$
declare uid uuid;
begin
  select id into uid from auth.users where email = 'elliotmharris@gmail.com';
  if uid is null then
    raise exception 'No auth user found for that email';
  end if;

  -- Child rows first (FK-safe), then parents.
  delete from game_annotations   where user_id = uid;
  delete from blunders           where user_id = uid;
  delete from training_sessions  where user_id = uid;
  delete from games              where user_id = uid;

  -- Reset the profile so isFirstRun is true: no linked account + zero games.
  update profiles set
    lichess_username        = null,
    chesscom_username       = null,
    last_synced_lichess_at  = null,
    last_synced_chesscom_at = null,
    current_streak_days     = 0,
    longest_streak_days     = 0,
    last_drill_local_date   = null
  where id = uid;

  raise notice 'Wiped all progress for user %', uid;
end $$;
