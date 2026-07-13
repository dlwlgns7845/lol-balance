-- 🔁 유찰 처리: 유찰된 선수 표시(대기 우선 지명 + 유찰 명단 + 재경매/잔여배정)
alter table tournament_pool add column if not exists passed boolean default false;
notify pgrst, 'reload schema';
