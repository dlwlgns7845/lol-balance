-- 🛡 디코봇 관리자 — 방(gid)별로 /기록 권한을 가진 유저.
-- 서버 관리자(Manage Guild/Administrator)는 기본으로 /기록 가능 + /관리자 승격/해제로 다른 사람에게 부여.
create table if not exists discord_bot_admins (
  gid uuid not null,
  discord_id text not null,
  name text,
  granted_by text,
  created_at timestamptz default now(),
  primary key (gid, discord_id)
);
notify pgrst, 'reload schema';
