// 티어 진단: 계정별 op.gg + Riot 신호 전부 출력. 케이스 패턴 분석용.
// 실행: node scripts/diag.mjs "이름#태그" "이름2#태그2:KR" ...  (지역 기본 NA, :KR 등으로 지정)
import fs from 'fs';
fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});
const { fetchProfile } = await import('../src/opgg.js');
const PLATFORM = { NA: 'na1', KR: 'kr', EUW: 'euw1', EUNE: 'eun1', BR: 'br1', JP: 'jp1', OCE: 'oc1' };
const REGIONAL = { NA: 'americas', BR: 'americas', LAN: 'americas', LAS: 'americas', OCE: 'americas', KR: 'asia', JP: 'asia', EUW: 'europe', EUNE: 'europe', TR: 'europe', RU: 'europe' };
const SEASON_DATE = {
  33: ['2026-01-08', '2027-01-07'], 31: ['2025-01-09', '2026-01-08'], 29: ['2024-09-25', '2025-01-09'],
  27: ['2024-05-15', '2024-09-25'], 25: ['2024-01-10', '2024-05-15'], 23: ['2023-07-17', '2024-01-10'],
  21: ['2023-01-10', '2023-07-17'], 19: ['2022-01-07', '2023-01-10'], 17: ['2021-01-08', '2022-01-07'],
};
const key = process.env.RIOT_API_KEY;
const rg = async (u) => { const r = await fetch(u, { headers: { 'X-Riot-Token': key } }); if (!r.ok) return { __s: r.status }; return r.json(); };
const sec = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000);

async function diag(name, tag, region) {
  const reg = (region || 'NA').toUpperCase();
  const regional = REGIONAL[reg] || 'americas';
  console.log(`\n══════ ${name}#${tag} (${reg}) ══════`);
  // op.gg
  let prof;
  try { prof = await fetchProfile(name, tag, reg); } catch (e) { return console.log('op.gg 에러', e.message); }
  if (!prof.found) return console.log('op.gg 못찾음:', prof.error);
  const cg = prof.solo ? (prof.solo.win || 0) + (prof.solo.lose || 0) : 0;
  console.log(`op.gg 현재솔랭: ${prof.solo?.tier || '언랭'}${prof.solo?.division || ''} ${prof.solo?.lp ?? ''}LP · ${cg}판`);
  console.log(`op.gg 현재시즌최고: ${prof.curHigh ? prof.curHigh.tier + (prof.curHigh.division || '') + ' ' + (prof.curHigh.lp ?? '') + 'LP' : '-'}`);
  console.log('op.gg 과거시즌(최고티어):', (prof.seasons || []).map((s) => `id${s.season_id}:${s.tier}${s.division || ''}${s.lp != null ? '(' + s.lp + ')' : ''}`).join(' '));
  // Riot
  const acc = await rg(`https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
  if (acc.__s) return console.log('Riot account 못찾음', acc.__s);
  let off = 0, last = null;
  for (let p = 0; p < 30; p++) { const ids = await rg(`https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${acc.puuid}/ids?start=${off}&count=100`); if (ids.__s || !ids.length) break; last = ids[ids.length - 1]; off += ids.length; if (ids.length < 100) break; }
  let oldest = '?'; if (last) { const m = await rg(`https://${regional}.api.riotgames.com/lol/match/v5/matches/${last}`); oldest = m?.info?.gameCreation ? new Date(m.info.gameCreation).toISOString().slice(0, 10) : '?'; }
  const sm = await rg(`https://${PLATFORM[reg] || 'na1'}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${acc.puuid}`);
  console.log(`Riot: 전체큐 ${off}판, 가장오래된 ${oldest}, 레벨 ${sm.summonerLevel ?? '?'}`);
  // 시즌별 솔랭 카운트 (op.gg 시즌들만)
  const cnt = async (s, e) => { let c = 0, o = 0; for (let p = 0; p < 4; p++) { const ids = await rg(`https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${acc.puuid}/ids?queue=420&startTime=${sec(s)}&endTime=${sec(e)}&start=${o}&count=100`); if (ids.__s || !ids.length) break; c += ids.length; o += ids.length; if (ids.length < 100) break; } return c >= 300 ? '300+' : c; };
  const parts = [];
  for (const s of (prof.seasons || []).slice(0, 6)) { const w = SEASON_DATE[s.season_id]; parts.push(`${s.tier}${s.division || ''}=${w ? await cnt(w[0], w[1]) + '판' : '표밖'}`); }
  console.log('Riot 시즌별 솔랭:', parts.join(' '));
}

const args = process.argv.slice(2);
for (const a of args) {
  const [idpart, region] = a.split(':');
  const [name, tag] = idpart.split('#');
  if (name && tag) await diag(name.trim(), tag.trim(), region);
}
process.exit(0);
