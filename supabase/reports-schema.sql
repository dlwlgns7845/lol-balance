-- 플레이어 신고 (비공개 · 운영자만 조회). 판단 근거로 데이터 축적.
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  gid uuid,                                  -- 내전 방(그룹)
  reporter_discord_id text,                  -- 신고자(실명성 — 보복·무고 억제)
  reporter_name text,
  target_discord_id text,                    -- 대상 디코 유저
  target_name text,                          -- 대상 표시명(신고 시점)
  category text not null,                    -- noshow | troll | toxic | other
  detail text,
  status text not null default 'open',       -- open | reviewed | dismissed | actioned
  created_at timestamptz not null default now()
);
create index if not exists idx_reports_gid on reports(gid, created_at desc);
create index if not exists idx_reports_target on reports(gid, target_discord_id);

-- public.* 새 테이블은 GRANT 명시 필요 (없으면 42501)
grant all on reports to anon, authenticated, service_role;
notify pgrst, 'reload schema';
