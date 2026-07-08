// Discord 인터랙션 엔드포인트 (슬래시 커맨드). Discord가 여기로 POST → 서명검증 후 응답.
// 상시봇(gateway) 아님 = 서버리스라 항상 켜져 있음(컴퓨터 꺼짐 무관).
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getStats, getAwards, listPersons, updatePerson } from '../../../src/repo.js';
import { balance } from '../../../src/engine.js';
import { TIER_LABEL, POS_KR } from '../../../src/table.js';

export const runtime = 'nodejs';

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const GID = process.env.DISCORD_DEFAULT_GID;
const GOLD = 0xe8c07d;
const normNm = (s) => (s || '').toLowerCase().replace(/\s+/g, '');

function verifySignature(sig, ts, body) {
  if (!sig || !ts || !PUBLIC_KEY) return false;
  try {
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(PUBLIC_KEY, 'hex')]);
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(ts + body), key, Buffer.from(sig, 'hex'));
  } catch { return false; }
}

const reply = (content) => NextResponse.json({ type: 4, data: { content, allowed_mentions: { parse: [] } } });
const embed = (e) => NextResponse.json({ type: 4, data: { embeds: [e], allowed_mentions: { parse: [] } } });
const callerId = (i) => i.member?.user?.id || i.user?.id;
const opt = (i, name) => (i.data?.options || []).find((o) => o.name === name)?.value;
const wr = (w) => `${Math.round((w || 0) * 100)}%`;
const posLabel = (p) => (p ? POS_KR[p] : '-');

// ── 커맨드 핸들러 ──
async function cmdLeaderboard() {
  const { players } = await getStats(GID);
  const top = players.filter((p) => p.games >= 3).sort((a, b) => b.score - a.score).slice(0, 10);
  if (!top.length) return reply('아직 3판 이상 뛴 선수가 없어요.');
  const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
  const lines = top.map((p, i) => `${medal(i)} **${p.nickname || p.name}** — ${p.score}점 · ${wr(p.winrate)} (${p.wins}승${p.losses}패)`);
  return embed({ title: '🏆 내전 리더보드 · 3판+', description: lines.join('\n'), color: GOLD });
}

function playerEmbed(p) {
  const champs = (p.topChamps || []).slice(0, 3).map((c) => `${c.champion}(${c.games})`).join(', ') || '-';
  const posLines = Object.entries(p.positionStats || {}).sort((a, b) => b[1].games - a[1].games)
    .map(([k, s]) => `${posLabel(k)} ${s.games}판 ${wr(s.winrate)}`).join(' · ') || '-';
  return {
    title: `📖 ${p.nickname || p.name} · ${TIER_LABEL[p.base_tier] || p.base_tier}`,
    color: GOLD,
    fields: [
      { name: '전적', value: `${p.games}게임 · ${wr(p.winrate)} (${p.wins}승 ${p.losses}패)`, inline: true },
      { name: 'KDA', value: p.kda != null ? String(p.kda) : '-', inline: true },
      { name: 'MVP · ACE', value: `🏅${p.mvp} · ⭐${p.ace}`, inline: true },
      { name: '평균 딜량', value: p.statGames ? p.avgDamage.toLocaleString() : '-', inline: true },
      { name: '주 라인', value: posLabel(p.mainPos), inline: true },
      { name: '모스트', value: champs, inline: false },
      { name: '포지션', value: posLines, inline: false },
    ],
  };
}

async function cmdRecord(i) {
  const q = normNm(opt(i, '선수') || '');
  if (!q) return reply('선수 이름을 입력하세요.');
  const { players } = await getStats(GID);
  const hit = players.filter((p) => p.games > 0).find((p) => normNm(p.nickname || p.name) === q)
    || players.filter((p) => p.games > 0).find((p) => normNm(p.nickname || p.name).includes(q));
  if (!hit) return reply(`"${opt(i, '선수')}" 선수를 못 찾았어요.`);
  return embed(playerEmbed(hit));
}

async function cmdMyRecord(i) {
  const persons = await listPersons(GID);
  const me = persons.find((p) => p.discord_id === callerId(i));
  if (!me) return reply('아직 연동 안 됐어요. `/연동 선수:내닉` 으로 먼저 연결하세요.');
  const { players } = await getStats(GID);
  const p = players.find((x) => x.id === me.id);
  if (!p || !p.games) return reply('연동은 됐는데 아직 기록이 없어요.');
  return embed(playerEmbed(p));
}

async function cmdLink(i) {
  const q = normNm(opt(i, '선수') || '');
  if (!q) return reply('연동할 선수 이름을 입력하세요.');
  const persons = await listPersons(GID);
  const target = persons.find((p) => normNm(p.display_name) === q || normNm(p.nickname || '') === q)
    || persons.find((p) => normNm(p.display_name).includes(q));
  if (!target) return reply(`"${opt(i, '선수')}" 선수를 못 찾았어요. 사람관리에 등록된 이름으로.`);
  await updatePerson(target.id, { discord_id: callerId(i) });
  return reply(`✅ <@${callerId(i)}> ↔ **${target.display_name}** 연동 완료! 이제 \`/내전적\`·\`/밸런스\`에서 자동 인식돼요.`);
}

async function cmdAwards() {
  const a = await getAwards(GID);
  const L = [];
  const line = (ic, t, who, stat) => who && L.push(`${ic} **${t}** — ${who} ${stat ? `(${stat})` : ''}`);
  line('🏆', '공공의적', a.publicEnemy?.name, a.publicEnemy && `${wr(a.publicEnemy.winrate)} ${a.publicEnemy.wins}승${a.publicEnemy.losses}패`);
  line('🚫', '기피대상', a.avoidPick?.name, a.avoidPick && `${wr(a.avoidPick.winrate)}`);
  line('💥', '캐리왕', a.carryKing?.name, a.carryKing && `평균딜 ${(a.carryKing.avgDamage / 1000).toFixed(1)}k`);
  line('🎮', '겜창', a.gameAddict?.name, a.gameAddict && `${a.gameAddict.games}판`);
  line('🏅', 'MVP왕', a.mvpKing?.name, a.mvpKing && `${a.mvpKing.mvp}회`);
  line('⭐', 'ACE왕', a.aceKing?.name, a.aceKing && `${a.aceKing.ace}회`);
  line('⚔️', '킬러', a.killer?.name, a.killer && `${a.killer.totalK}킬`);
  line('💀', '시체', a.corpse?.name, a.corpse && `${a.corpse.totalD}데스`);
  line('🔧', '도구', a.tool?.name, a.tool && `${a.tool.totalA}어시`);
  if (a.bestDuo) L.push(`💞 **최고의 듀오** — ${a.bestDuo.a} + ${a.bestDuo.b} (${wr(a.bestDuo.winrate)})`);
  if (!L.length) return reply('아직 칭호 데이터가 부족해요.');
  return embed({ title: '🎖 명예의 전당', description: L.join('\n'), color: GOLD });
}

async function cmdRoom() {
  const st = await getStats(GID);
  const ranked = st.players.filter((p) => p.games >= 3);
  const topWr = [...ranked].sort((a, b) => (b.wins + 2) / (b.games + 4) - (a.wins + 2) / (a.games + 4))[0];
  const topDmg = [...ranked].filter((p) => p.statGames).sort((a, b) => b.avgDamage - a.avgDamage)[0];
  return embed({
    title: '🏠 내전 방 요약', color: GOLD,
    fields: [
      { name: '총 내전', value: `${st.totalMatches}게임`, inline: true },
      { name: '등록 선수', value: `${st.players.length}명`, inline: true },
      { name: '최고 승률', value: topWr ? `${topWr.nickname || topWr.name} ${wr(topWr.winrate)}` : '-', inline: true },
      { name: '평균 딜 1위', value: topDmg ? `${topDmg.nickname || topDmg.name} ${(topDmg.avgDamage / 1000).toFixed(1)}k` : '-', inline: true },
    ],
  });
}

async function cmdBalance(i) {
  const raw = opt(i, '명단') || '';
  const ids = [...raw.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]);
  if (ids.length !== 10) return reply(`10명을 멘션하세요 (현재 ${ids.length}명). 예: \`/밸런스 명단:@a @b … @j\``);
  const persons = await listPersons(GID);
  const byDiscord = new Map(persons.filter((p) => p.discord_id).map((p) => [p.discord_id, p]));
  const linked = [], missing = [];
  for (const id of ids) { const p = byDiscord.get(id); if (p) linked.push(p); else missing.push(id); }
  if (missing.length) return reply(`먼저 \`/연동\` 필요: ${missing.map((id) => `<@${id}>`).join(' ')}`);
  const players = linked.map((p) => ({
    name: p.display_name, tier: p.base_tier, secondaryTier: p.secondary_tier || null,
    positions: [...(p.primary_positions || []), ...(p.secondary_positions || [])],
    primary: p.primary_positions || [],
  }));
  if (players.some((p) => !p.positions.length)) return reply('포지션 미지정 선수가 있어요. 사람관리에서 포지션 지정 후 다시.');
  const r = balance(players, {});
  if (!r.feasible) return reply('이 구성으론 팀이 안 짜여요 (포지션 다양성 부족).');
  const c = r.candidates[0];
  const side = (T) => c.lanes.map((l) => { const x = l[T]; return `${POS_KR[l.pos]} · ${x.name} (${TIER_LABEL[x.tier] || x.tier})`; }).join('\n');
  const light = { green: '🟢 균형', yellow: '🟡 약간 기움', red: '🔴 불균형' }[c.light];
  return embed({
    title: '⚔️ 팀 밸런스', description: `${light} · 총점차 ${c.totalDiff.toFixed(1)}`, color: GOLD,
    fields: [
      { name: `🔵 블루 (${c.sumA.toFixed(0)})`, value: side('a'), inline: true },
      { name: `🔴 레드 (${c.sumB.toFixed(0)})`, value: side('b'), inline: true },
    ],
  });
}

const HANDLERS = { 리더보드: cmdLeaderboard, 전적: cmdRecord, 내전적: cmdMyRecord, 연동: cmdLink, 칭호: cmdAwards, 방: cmdRoom, 밸런스: cmdBalance };

export async function POST(request) {
  const body = await request.text();
  if (!verifySignature(request.headers.get('x-signature-ed25519'), request.headers.get('x-signature-timestamp'), body)) {
    return new NextResponse('invalid request signature', { status: 401 });
  }
  const i = JSON.parse(body);
  if (i.type === 1) return NextResponse.json({ type: 1 }); // PING → PONG
  if (i.type === 2) {
    if (!GID) return reply('⚠️ 방 설정(DISCORD_DEFAULT_GID)이 없어요.');
    const h = HANDLERS[i.data?.name];
    if (!h) return reply('알 수 없는 명령어예요.');
    try { return await h(i); } catch (e) { return reply('오류: ' + e.message); }
  }
  return NextResponse.json({ type: 4, data: { content: '지원하지 않는 인터랙션' } });
}
