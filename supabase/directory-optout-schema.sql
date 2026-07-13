-- 🙈 명단 옵트아웃: 로그인 유저가 공동운영자 후보/명단에서 자기 계정을 숨김.
create table if not exists directory_optout (
  user_id uuid primary key,
  created_at timestamptz default now()
);
grant all on directory_optout to service_role, anon, authenticated;
notify pgrst, 'reload schema';
