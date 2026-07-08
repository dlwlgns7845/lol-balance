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
// 신규 가입용 티어 20종(대표) — 37개 전부는 Discord 선택지 한도(25) 초과 → 어드민이 웹에서 정밀조정
const TIER_CHOICES = [
  ['실버', 'S2'], ['골드4', 'G4'], ['골드3', 'G3'], ['골드2', 'G2'], ['골드1', 'G1'],
  ['플래4', 'P4'], ['플래3', 'P3'], ['플래2', 'P2'], ['플래1', 'P1'],
  ['에메4', 'E4'], ['에메3', 'E3'], ['에메2', 'E2'], ['에메1', 'E1'],
  ['다이아4', 'D4'], ['다이아3', 'D3'], ['다이아2', 'D2'], ['다이아1', 'D1'],
  ['마스터', 'M200'], ['그마', 'M800'], ['챌린저', 'M1400'],
].map(([name, value]) => ({ name, value }));
const LANE_CHOICES = [['탑', 'top'], ['정글', 'jungle'], ['미드', 'mid'], ['원딜', 'adc'], ['서폿', 'sup']].map(([name, value]) => ({ name, value }));
const commands = [
  { name: '리더보드', description: '내전 리더보드 TOP 10 (3판+)', type: 1 },
  { name: '전적', description: '선수 전적·챔프·포지션', type: 1, options: [S('선수', '선수 이름')] },
  { name: '내전적', description: '내 전적 (연동 필요)', type: 1 },
  { name: '연동', description: '이미 등록된 내 카드에 디코 연결', type: 1, options: [S('선수', '내 등록 이름')] },
  { name: '가입', description: '신규: 내 선수 카드 만들고 연동 (계정당 1개)', type: 1, options: [
    { name: '이름', description: '게임 표시 이름', type: 3, required: true },
    { name: '티어', description: '현재 티어', type: 3, required: true, choices: TIER_CHOICES },
    { name: '주라인', description: '메인 라인', type: 3, required: true, choices: LANE_CHOICES },
    { name: '부라인', description: '서브 라인 (선택)', type: 3, required: false, choices: LANE_CHOICES },
  ] },
  { name: '칭호', description: '명예의 전당 (공공의적·캐리왕 등)', type: 1 },
  { name: '방', description: '내전 방 요약 통계', type: 1 },
  { name: '밸런스', description: '멘션 10명으로 팀 짜기', type: 1, options: [S('명단', '@a @b … @j (10명 멘션)')] },
  { name: '모집', description: '내전 모집 시작 (버튼으로 라인 선착순)', type: 1,
    options: [{ name: '인원', description: '10 또는 20 (기본 10)', type: 4, required: false,
      choices: [{ name: '10인', value: 10 }, { name: '20인', value: 20 }] }] },
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
