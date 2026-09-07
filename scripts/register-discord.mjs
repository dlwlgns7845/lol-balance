// Discord 슬래시 커맨드 등록. 실행: node scripts/register-discord.mjs
// .env.local 에서 DISCORD_APP_ID, DISCORD_BOT_TOKEN 읽음. GUILD_ID 있으면 그 서버에 즉시(테스트), 없으면 글로벌(~1시간).
import fs from 'fs';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const APP_ID = process.env.DISCORD_APP_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
// 서버 지정: --guild=<서버ID> (우선) 또는 .env.local DISCORD_GUILD_ID. 즉시 등록용.
const GUILD_ID = (process.argv.find((a) => a.startsWith('--guild=')) || '').split('=')[1] || process.env.DISCORD_GUILD_ID;
if (!APP_ID || !TOKEN) { console.error('DISCORD_APP_ID / DISCORD_BOT_TOKEN 가 .env.local 에 필요합니다.'); process.exit(1); }

const S = (name, description, required = true) => ({ name, description, type: 3, required }); // STRING 옵션
const LANE_CHOICES = [['탑', 'top'], ['정글', 'jungle'], ['미드', 'mid'], ['원딜', 'adc'], ['서폿', 'sup']].map(([name, value]) => ({ name, value }));
// 티어는 사용자가 안 고름 — 닉네임을 우리 시스템이 측정. 지역만 선택(라이엇 라우팅용).
const REGION_CHOICES = ['NA', 'KR', 'EUW', 'EUNE', 'BR', 'JP', 'OCE', 'LAN', 'LAS', 'TR', 'RU'].map((r) => ({ name: r, value: r }));
const commands = [
  { name: '리더보드', description: '내전 리더보드 TOP 10 (3판+)', type: 1 },
  { name: '전적', description: '선수 전적·챔프·포지션', type: 1, options: [S('선수', '선수 이름')] },
  { name: '내전적', description: '내 전적 (연동 필요)', type: 1 },
  { name: '연동', description: '이미 등록된 내 카드에 디코 연결', type: 1, options: [S('선수', '내 등록 이름')] },
  { name: '가입', description: '신규: 닉네임으로 티어 자동측정 + 카드 생성·연동 (계정당 1개)', type: 1, options: [
    { name: '닉네임', description: '라이엇 ID (게임닉#태그) — 예: 홍길동#KR1', type: 3, required: true },
    { name: '주라인', description: '메인 라인', type: 3, required: true, choices: LANE_CHOICES },
    { name: '지역', description: '서버 (기본 NA)', type: 3, required: false, choices: REGION_CHOICES },
    { name: '부라인', description: '서브 라인 (선택)', type: 3, required: false, choices: LANE_CHOICES },
  ] },
  { name: '프로필', description: '내 아바타 — 사진 업로드 또는 디스코드 프로필 사진', type: 1, options: [
    { name: '사진', description: '프로필 사진 업로드 (이미지, 4MB 이하)', type: 11, required: false },
    { name: '디코사진', description: '디스코드 프로필 사진 사용', type: 5, required: false },
  ] },
  { name: '칭호', description: '명예의 전당 (공공의적·캐리왕 등)', type: 1 },
  { name: '방', description: '내전 방 요약 통계', type: 1 },
  { name: '밸런스', description: '멘션 10명으로 팀 짜기', type: 1, options: [S('명단', '@a @b … @j (10명 멘션)')] },
  { name: '모집', description: '내전 모집 시작 (버튼으로 라인 선착순)', type: 1,
    options: [{ name: '인원', description: '10 또는 20 (기본 10)', type: 4, required: false,
      choices: [{ name: '10인', value: 10 }, { name: '20인', value: 20 }] }] },
  { name: '기록', description: '.rofl 리플레이로 경기 자동 기록 (관리자)', type: 1,
    default_member_permissions: '32', // Manage Guild — 관리자만
    options: [{ name: '리플', description: '롤 리플레이(.rofl) 파일 — 클라이언트 전적에서 다운로드', type: 11, required: true }] },
  { name: '방연결', description: '이 서버를 내전 방/대회에 연결 (서버 관리자만)', type: 1,
    default_member_permissions: '32', // Manage Guild — 관리자만
    options: [
      { name: '코드', description: '내전 방 코드 (방 연결)', type: 3, required: false },
      { name: '대회', description: '대회 코드 (대회 연결 — 사이트 대회 관리자 탭)', type: 3, required: false },
    ] },
  { name: '대회공지', description: '이 채널을 대회 공지 채널로 설정/해제 (서버 관리자만)', type: 1,
    default_member_permissions: '32', // Manage Guild
    options: [{ name: '동작', description: '연결(기본) / 해제', type: 3, required: false,
      choices: [{ name: '연결', value: '연결' }, { name: '해제', value: '해제' }] }] },
  { name: '관리자', description: '봇 관리자 승격/해제 (서버 관리자 전용) — /기록 권한 부여', type: 1,
    default_member_permissions: '32', // Manage Guild — 서버 관리자만
    options: [
      { name: '동작', description: '승격 / 해제 / 목록', type: 3, required: true,
        choices: [{ name: '승격', value: '승격' }, { name: '해제', value: '해제' }, { name: '목록', value: '목록' }] },
      { name: '유저', description: '대상 유저 (승격·해제 시)', type: 6, required: false },
    ] },
  { name: '신고', description: '플레이어 신고 (운영자에게만 전달 · 비공개)', type: 1, options: [
    { name: '대상', description: '신고할 유저', type: 6, required: true },
    { name: '사유', description: '신고 사유', type: 3, required: true, choices: [
      { name: '노쇼/잠수', value: 'noshow' }, { name: '트롤/대리', value: 'troll' },
      { name: '비매너/욕설', value: 'toxic' }, { name: '기타', value: 'other' }] },
    { name: '내용', description: '상세 내용 (선택)', type: 3, required: false },
  ] },
  { name: '신고목록', description: '신고 내역 조회 (운영진 전용 · 나만 보임)', type: 1,
    default_member_permissions: '2' }, // Kick Members — 모드팀(추방 권한)에게 노출. 서버단에서 추방·차단·관리자·서버관리 허용
  { name: '신고채널', description: '이 채널을 비공개 신고 알림 채널로 설정/해제 (운영진)', type: 1,
    default_member_permissions: '2', // Kick Members
    options: [{ name: '동작', description: '연결(기본) / 해제', type: 3, required: false,
      choices: [{ name: '연결', value: '연결' }, { name: '해제', value: '해제' }] }] },
  { name: '롤체', description: '롤토체스 깐부 내전 — 신청받아 랜덤 2인조(깐부)', type: 1,
    options: [{ name: '인원', description: '목표 인원 (기본 8)', type: 4, required: false,
      choices: [{ name: '8명', value: 8 }, { name: '4명', value: 4 }, { name: '16명', value: 16 }] }] },
];

// --global (또는 GUILD_ID 없음) = 전역 등록(모든 서버, ~1시간). 아니면 GUILD_ID 서버에 즉시(테스트).
const headers = { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' };
const GLOBAL = process.argv.includes('--global') || !GUILD_ID;
const url = GLOBAL
  ? `https://discord.com/api/v10/applications/${APP_ID}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;

const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(commands) });
const txt = await res.text();
if (!res.ok) { console.error('등록 실패', res.status, txt); process.exit(1); }
console.log(`✅ 커맨드 등록됨 (${GLOBAL ? '글로벌 · 모든 서버 · 최대 1시간 반영' : '서버 ' + GUILD_ID + ' 즉시'}):`, JSON.parse(txt).map((c) => '/' + c.name).join(', '));

// 전역 등록 시 테스트 서버 길드 커맨드는 정리(같은 커맨드 중복 표시 방지)
if (GLOBAL && GUILD_ID) {
  await fetch(`https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`, { method: 'PUT', headers, body: JSON.stringify([]) });
  console.log('🧹 테스트 서버 길드 커맨드 정리 (중복 방지)');
}
