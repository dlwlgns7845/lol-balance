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

-- 신고 알림 채널 (비공개 · 운영진 전용 채널을 /신고채널 로 지정). 새 신고가 여기로 포스팅됨.
alter table discord_guilds add column if not exists report_channel_id text;

-- 모집 큐 관리 역할 (/모집권한 으로 지정). 이 역할을 가진 사람은 권한 비트 없이도 마감·킥·전환 가능.
alter table discord_guilds add column if not exists manager_role_id text;

-- public.* 새 테이블은 GRANT 명시 필요 (없으면 42501)
grant all on reports to anon, authenticated, service_role;
notify pgrst, 'reload schema';
