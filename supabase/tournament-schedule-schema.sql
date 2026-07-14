-- 🗓 경기 일정: 대진 각 경기에 날짜/시간 (관리자가 설정/해제)
alter table tournament_matches add column if not exists scheduled_at timestamptz;
notify pgrst, 'reload schema';
