// Discord 슬래시 커맨드 등록. 실행: node scripts/register-discord.mjs
// .env.local 에서 DISCORD_APP_ID, DISCORD_BOT_TOKEN 읽음. GUILD_ID 있으면 그 서버에 즉시(테스트), 없으면 글로벌(~1시간).
import fs from 'fs';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const APP_ID = process.env.DISCORD_APP_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // 선택: 테스트 서버 즉시 등록
if (!APP_ID || !TOKEN) { console.error('DISCORD_APP_ID / DISCORD_BOT_TOKEN 가 .env.local 에 필요합니다.'); process.exit(1); }

const S = (name, description, required = true) => ({ name, description, type: 3, required }); // STRING 옵션
const LANE_CHOICES = [['탑', 'top'], ['정글', 'jungle'], ['미드', 'mid'], ['원딜', 'adc'], ['서폿', 'sup']].map(([name, value]) => ({ name, value }));
// 티어는 사용자가 안 고름 — 닉네임을 우리 시스템이 측정. 지역만 선택(라이엇 라우팅용).
const REGION_CHOICES = ['NA', 'KR', 'EUW', 'EUNE', 'BR', 'JP', 'OCE', 'LAN', 'LAS', 'TR', 'RU'].map((r) => ({ name: r, value: r }));
const COLOR_CHOICES = [
  ['빨강', '#e84d4d'], ['주황', '#e8944d'], ['노랑', '#e8d24d'], ['초록', '#4dc85f'], ['청록', '#4dc8b0'],
  ['파랑', '#4d7de8'], ['보라', '#9b4de8'], ['분홍', '#e84db0'], ['회색', '#8a8a92'], ['검정', '#2a2a30'], ['흰색', '#e8e8ee'],
].map(([name, value]) => ({ name, value }));
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
  { name: '프로필', description: '내 사이트 아바타 꾸미기 (기본=디코 프로필 사진)', type: 1, options: [
    { name: '사진', description: '프로필 사진 업로드 (이미지, 4MB 이하)', type: 11, required: false },
    { name: '색', description: '아바타 색', type: 3, required: false, choices: COLOR_CHOICES },
    { name: '이모지', description: '이모지/글자 (없음=제거)', type: 3, required: false },
    { name: '디코사진', description: '디스코드 프로필 사진으로 되돌리기', type: 5, required: false },
  ] },
  { name: '칭호', description: '명예의 전당 (공공의적·캐리왕 등)', type: 1 },
  { name: '방', description: '내전 방 요약 통계', type: 1 },
  { name: '밸런스', description: '멘션 10명으로 팀 짜기', type: 1, options: [S('명단', '@a @b … @j (10명 멘션)')] },
  { name: '모집', description: '내전 모집 시작 (버튼으로 라인 선착순)', type: 1,
    options: [{ name: '인원', description: '10 또는 20 (기본 10)', type: 4, required: false,
      choices: [{ name: '10인', value: 10 }, { name: '20인', value: 20 }] }] },
  { name: '기록', description: '스코어보드 스샷으로 경기 자동 기록 (관리자)', type: 1,
    default_member_permissions: '32', // Manage Guild — 관리자만
    options: [{ name: '스샷', description: '로비 종료 스코어보드 이미지', type: 11, required: true }] },
  { name: '방연결', description: '이 서버를 내전 방에 연결 요청 (서버 관리자만, 방장 승인 필요)', type: 1,
    default_member_permissions: '32', // Manage Guild — 관리자만
    options: [{ name: '코드', description: '사이트 방 코드', type: 3, required: true }] },
];

const url = GUILD_ID
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(commands),
});
const txt = await res.text();
if (!res.ok) { console.error('등록 실패', res.status, txt); process.exit(1); }
console.log(`✅ 커맨드 등록됨 (${GUILD_ID ? '서버 ' + GUILD_ID + ' 즉시' : '글로벌 · 최대 1시간 반영'}):`, JSON.parse(txt).map((c) => '/' + c.name).join(', '));
