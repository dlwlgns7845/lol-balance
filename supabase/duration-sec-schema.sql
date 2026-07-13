-- ⏱ 게임 시간 초 단위 저장 (mm:ss 표시용). 기존 duration_min(분, CS/분 계산용)은 유지.
--    스키마 미반영이어도 저장/조회는 duration_min으로 폴백 → 안전.
alter table matches add column if not exists duration_sec int;
notify pgrst, 'reload schema';
