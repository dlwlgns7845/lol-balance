-- 🧩 대회 커스텀 설정 — 주최자가 조립하는 옵션 묶음 (기존 대회 무영향, nullable).
--    { eligibility:{minLevel,tierCap,tierFloor,rosterSize}, format, bestOf, seeding, scoring:{winPts} }
alter table tournaments add column if not exists settings jsonb;
notify pgrst, 'reload schema';
