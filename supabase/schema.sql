-- LoL 내전 밸런서 — Supabase 스키마 (재실행 안전: 이미 만든 위에 다시 Run 해도 OK)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run.

-- 방/모임 (멀티-그룹: 빙수방은 빙수방끼리, 다른 모임은 그들끼리. 코드로 구분)
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                          -- 공유용 코드 (예: bingsu)
  name text not null,                                 -- 방 이름 (예: 빙수방 내전)
  created_at timestamptz not null default now()
);
-- 방별 커스텀 점수표 (null = 기본 멸망전 표 사용)
alter table groups add column if not exists score_table jsonb;
-- 방장(소유자). null = 레거시 방(권한 미설정 → 누구나 편집). claim 하면 채워짐.
alter table groups add column if not exists owner_id uuid;

-- 방 멤버 권한 (구글 로그인 유저 단위). role: owner=방장 / editor=편집가능 / viewer=구경만
create table if not exists room_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null,                              -- auth.users.id (구글 로그인 유저)
  email text,
  name text,
  role text not null default 'viewer' check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists idx_room_members_group on room_members(group_id);

-- 사람 (실제 플레이어 1명. 본캐/부캐 여러 계정을 묶는 단위)
create table if not exists persons (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  base_tier text not null default 'G2',              -- 운영자 확정 밸런싱 티어 (점수표 키)
  primary_positions text[] not null default '{}',
  secondary_positions text[] not null default '{}',
  adjust numeric not null default 0,                 -- 내전 결과 보정 델타 (Elo식)
  rating_games int not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
alter table persons add column if not exists group_id uuid references groups(id) on delete cascade;
-- 별명(보조 라벨). display_name=인게임 닉(매칭 메인키), nickname=사람 알아보기용 별명
alter table persons add column if not exists nickname text;

-- Riot 계정 (본캐/부캐) → 한 사람에 여러 개
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id) on delete cascade,
  game_name text not null,
  tag_line text not null,
  region text not null default 'NA',
  is_main boolean not null default false,
  opgg_tier text,
  opgg_games int,
  opgg_confidence text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (game_name, tag_line, region)
);

-- 내전 경기
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  played_at timestamptz not null default now(),
  winner text check (winner in ('A','B')),
  total_weight numeric,
  notes text,
  created_at timestamptz not null default now()
);
alter table matches add column if not exists group_id uuid references groups(id) on delete cascade;
alter table matches add column if not exists objectives jsonb;  -- {A:{towers,inhibitors,barons,dragons,heralds,voidgrubs}, B:{...}}
alter table matches add column if not exists bans jsonb;        -- {A:[champ,...], B:[...]}
alter table matches add column if not exists duration_min int;  -- 게임 시간(분) — 분당 CS 계산용

-- 경기 참가자 (경기당 10명)
create table if not exists match_participants (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  person_id uuid not null references persons(id),
  account_id uuid references accounts(id),
  team text not null check (team in ('A','B')),
  position text not null check (position in ('top','jungle','mid','adc','sup')),
  tier_at_match text,
  points numeric,
  champion text,
  kills int, deaths int, assists int, cs int,
  win boolean,
  created_at timestamptz not null default now()
);

-- 스샷 AI 추출용 추가 컬럼 + 포지션 nullable (스샷엔 포지션 정보 없음)
alter table match_participants add column if not exists gold int;
alter table match_participants add column if not exists damage int;
alter table match_participants add column if not exists slot int; -- 스샷 행 순서 보존(0~9)
alter table match_participants alter column position drop not null;

-- 레이팅 변동 이력
create table if not exists rating_events (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons(id) on delete cascade,
  match_id uuid references matches(id) on delete set null,
  delta numeric not null,
  rating_after numeric not null,
  created_at timestamptz not null default now()
);

-- 챔피언 인식 레퍼런스 (실제 스코어보드 crop 축적 → self-improving 매칭). 전역 공유.
create table if not exists champion_refs (
  id uuid primary key default gen_random_uuid(),
  champion text not null,
  vec text not null,                                  -- 32x32 RGB crop을 base64로
  created_at timestamptz not null default now()
);
-- 밴 아이콘은 정사각 아트(슬래시)라 플레이어 초상화와 다른 레퍼런스 → kind로 분리
alter table champion_refs add column if not exists kind text not null default 'player';
create index if not exists idx_champion_refs_champ on champion_refs(champion);
create index if not exists idx_champion_refs_kind on champion_refs(kind);

-- ── 디스코드 봇 (2026-07 추가) ──
-- persons: 디코 연동/프로필/부라인 티어
alter table persons add column if not exists discord_id text;        -- 디코 유저 ID (1인 1연동)
alter table persons add column if not exists profile jsonb;          -- { avatar: url } 프로필 사진
alter table persons add column if not exists secondary_tier text;    -- 부라인 배치 시 적용 티어 (점수표 키)
-- groups: 저티어 자동보정 on/off
alter table groups add column if not exists adjust_enabled boolean not null default false;

-- 디스코드 서버(guild) ↔ 방 매핑 (승인 방식: pending → 방장이 사이트에서 approved)
create table if not exists discord_guilds (
  guild_id text primary key,
  group_id uuid not null references groups(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved')),
  linked_by text,
  guild_name text,
  guild_icon text,             -- 디코 서버 아이콘 해시 (헤더 브랜딩용). cdn: /icons/{guild_id}/{hash}.png
  created_at timestamptz not null default now()
);
alter table discord_guilds add column if not exists guild_icon text;

-- 내전 모집 큐 (디코 /모집 + 사이트 미러). 서버리스라 상태는 전부 DB.
create table if not exists recruit_queues (
  id uuid primary key default gen_random_uuid(),
  gid uuid not null references groups(id) on delete cascade,
  size int not null default 10,
  status text not null default 'open' check (status in ('open','closed')),
  host_id text,                                       -- 모집 만든 디코 유저 (마감 권한)
  channel_id text,                                    -- 디코 채널 (사이트→디코 메시지 갱신용)
  message_id text,                                    -- 디코 메시지 (사이트→디코 PATCH)
  created_at timestamptz not null default now()
);
create index if not exists idx_recruit_queues_gid on recruit_queues(gid, status);

-- 모집 신청 (discord_id 또는 'site:<personId>'). created_at = 선착순.
create table if not exists recruit_signups (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references recruit_queues(id) on delete cascade,
  discord_id text not null,
  name text,
  main text,                                          -- top/jungle/mid/adc/sup/all
  sub text,                                           -- 위와 동일 + null
  created_at timestamptz not null default now()
);
create index if not exists idx_recruit_signups_queue on recruit_signups(queue_id);
-- upsertSignup이 조회→insert 라 동시클릭 중복 방지용 유니크 (이미 중복 있으면 이 줄만 실패 — 정리 후 재실행)
create unique index if not exists uq_recruit_signups_member on recruit_signups(queue_id, discord_id);

-- 스샷 판독 대기 + /밸런스 리롤 상태 (임시 보관, 생성 24h 후 자동정리 대상)
create table if not exists pending_matches (
  id uuid primary key default gen_random_uuid(),
  gid uuid,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_persons_group on persons(group_id);
create index if not exists idx_matches_group on matches(group_id);
create index if not exists idx_accounts_person on accounts(person_id);
create index if not exists idx_participants_match on match_participants(match_id);
create index if not exists idx_participants_person on match_participants(person_id);
create index if not exists idx_rating_events_person on rating_events(person_id);
