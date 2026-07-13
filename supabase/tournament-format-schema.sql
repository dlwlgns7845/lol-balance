-- 🏆 멸망전 포맷 확장 (그룹 스테이지·더블엘리). 기존 싱글엘리(bracket NULL)는 무영향.
--    bracket: 'G'=조별, 'K'=본선(그룹→녹아웃), 'W'=승자조, 'L'=패자조, 'GF'=최종결승. NULL=싱글엘리.
--    grp: 조 번호(0-based, 그룹 스테이지 전용).
alter table tournament_matches add column if not exists bracket text;
alter table tournament_matches add column if not exists grp int;
notify pgrst, 'reload schema';
