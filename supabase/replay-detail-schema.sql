-- 🎬 리플(.rofl) 상세 데이터용 — 기존 기록에 전혀 영향 없음 (전부 nullable 추가 컬럼).
--    기존 경기·스샷 경기 = 이 컬럼들 null 유지 / 리플로 올린 경기만 채워짐.
--    통계(첫용/4용/voidgrub 승률 등)는 나중에 objectives jsonb에서 계산 → 공간만 미리 확보.

alter table matches add column if not exists source text;          -- 'replay' | 'screenshot' | 'manual' | null(기존)
alter table matches add column if not exists objectives jsonb;     -- 팀별 오브젝트: {A:{kills,gold,dragons,elder,barons,heralds,grubs,atakhan,towers,inhibs}, B:{...}}
alter table match_participants add column if not exists detail jsonb; -- 선수별 상세: 아이템·비전·골드·딜분포·멀티킬·룬·소환사스펠 등

notify pgrst, 'reload schema';
