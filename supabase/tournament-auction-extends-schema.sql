-- ⏱ 타이머 연장 횟수 추적 (연장 상한 → 하드 마감/스나이핑)
alter table tournament_auction add column if not exists extends int default 0;
notify pgrst, 'reload schema';
