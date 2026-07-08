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
const commands = [
  { name: '리더보드', description: '내전 리더보드 TOP 10 (3판+)', type: 1 },
  { name: '전적', description: '선수 전적·챔프·포지션', type: 1, options: [S('선수', '선수 이름')] },
  { name: '내전적', description: '내 전적 (연동 필요)', type: 1 },
  { name: '연동', description: '내 디코 ↔ 내전 선수 연결', type: 1, options: [S('선수', '내 등록 이름')] },
  { name: '칭호', description: '명예의 전당 (공공의적·캐리왕 등)', type: 1 },
  { name: '방', description: '내전 방 요약 통계', type: 1 },
  { name: '밸런스', description: '멘션 10명으로 팀 짜기', type: 1, options: [S('명단', '@a @b … @j (10명 멘션)')] },
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
