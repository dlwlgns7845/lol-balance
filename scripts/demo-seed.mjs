// 데모 데이터 시더: "demo" 방에 선수10 + 경기22 채움 (디자인/통계 미리보기용).
// 실행: node scripts/demo-seed.mjs  ·  방 코드 "demo"로 입장하면 채워진 통계가 보임.
import fs from 'fs';
fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});
const { createGroup, getGroupByCode, createPerson, listPersons, saveMatch } = await import('../src/repo.js');
const { db } = await import('../src/supabase.js');

const CODE = 'demo';
let g = await getGroupByCode(CODE);
if (!g) g = await createGroup(CODE, '데모 내전방');
console.log('group', g.id);

// 기존 데모 데이터 정리(멱등 재실행)
const old = await listPersons(g.id);
for (const p of old) await db().from('match_participants').delete().eq('person_id', p.id);
await db().from('matches').delete().eq('group_id', g.id);
await db().from('persons').delete().eq('group_id', g.id);

const PEOPLE = [
  ['Junliang', '형', 'M700'], ['tenduck', '텐덕', 'S3-'], ['Muted', '뮤트', 'M500'], ['faku', '파쿠', 'D3'],
  ['My name is Nimo', '니모', 'P2'], ['Unknown', '언노운', 'M700'], ['SnowflakeCompany', '스노우', 'D1'],
  ['bony whimsark', '보니', 'D2'], ['Sleep', '슬립', 'E1'], ['One Deal', '딜원', 'D4'],
];
const persons = [];
for (const [dn, nick, tier] of PEOPLE) {
  persons.push(await createPerson(g.id, { display_name: dn, nickname: nick, base_tier: tier, primary_positions: [], secondary_positions: [] }));
}
console.log('persons', persons.length);

const CH = ['Garen', 'Darius', 'Sett', 'Aatrox', 'Camille', 'LeeSin', 'Viego', 'Hecarim', 'Graves', 'JarvanIV',
  'Ahri', 'Sylas', 'Akali', 'Yone', 'Orianna', 'Syndra', 'Caitlyn', 'Jinx', 'Ezreal', 'Jhin', 'Kaisa',
  'Thresh', 'Leona', 'Nautilus', 'Lulu', 'Zed', 'Yasuo', 'Vi', 'Sejuani', 'Lux', 'Viktor', 'Senna'];
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[ri(0, arr.length - 1)];

for (let m = 0; m < 22; m++) {
  const idx = [...Array(10).keys()].sort(() => rnd() - 0.5);
  const winner = rnd() < 0.5 ? 'A' : 'B';
  const usedCh = new Set();
  const parts = idx.map((pi, k) => {
    const team = k < 5 ? 'A' : 'B'; const win = team === winner;
    let c; do { c = pick(CH); } while (usedCh.has(c)); usedCh.add(c);
    const kf = win ? 1.4 : 0.8;
    const kills = Math.max(0, Math.round(ri(1, 12) * kf));
    const deaths = Math.max(0, Math.round(ri(2, 9) * (win ? 0.8 : 1.3)));
    const assists = ri(2, 18);
    const damage = Math.round(ri(9000, 34000) * (win ? 1.15 : 0.95));
    const cs = (k % 5 === 4) ? ri(20, 60) : Math.round(ri(120, 260) * (win ? 1.05 : 0.95)); // 5번째=서폿 낮게
    return { person_id: persons[pi].id, team, champion: c, k: kills, d: deaths, a: assists, damage, cs };
  });
  await saveMatch(g.id, { winner, participants: parts });
}
console.log('matches 22 done. 방 코드 "demo" 입장 → 채워진 통계.');
process.exit(0);
