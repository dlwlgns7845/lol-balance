-- 대회 체크인 (노쇼 방지) — 대진 전 팀별 참가확인. 주장 셀프체크 or 운영자 지정.
alter table tournament_teams add column if not exists checked_in boolean not null default false;

notify pgrst, 'reload schema';
