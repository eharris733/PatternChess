-- Daily loop (retention roadmap Phase 1):
--  * Commitment level: a preset label plus the two numbers the daily plan
--    reads. Presets live in src/lib/dailyGoal.ts (COMMITMENT_PRESETS); the
--    numbers are always stored so a preset retune never moves existing users.
--  * Streak freezes: one earned per 7 streak days, at most 2 banked; a missed
--    day spends one instead of resetting the streak (src/services/streakService.ts).

alter table public.profiles
  add column if not exists commitment_level text not null default 'regular',
  add column if not exists daily_positions_goal integer not null default 10,
  add column if not exists daily_games_goal integer not null default 1,
  add column if not exists streak_freezes integer not null default 0,
  add column if not exists streak_freezes_used integer not null default 0;

alter table public.profiles
  drop constraint if exists profiles_commitment_level_check,
  add constraint profiles_commitment_level_check
    check (commitment_level in ('casual', 'regular', 'serious', 'obsessed', 'custom')),
  drop constraint if exists profiles_daily_positions_goal_check,
  add constraint profiles_daily_positions_goal_check
    check (daily_positions_goal between 1 and 100),
  drop constraint if exists profiles_daily_games_goal_check,
  add constraint profiles_daily_games_goal_check
    check (daily_games_goal between 0 and 10),
  drop constraint if exists profiles_streak_freezes_check,
  add constraint profiles_streak_freezes_check
    check (streak_freezes between 0 and 2);
