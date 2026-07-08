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

const commands = [
  { name: '리더보드', description: '우리 내전 리더보드 TOP 10 (3판+)', type: 1 },
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
