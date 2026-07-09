// Discord 인터랙션 엔드포인트 (슬래시 커맨드). Discord가 여기로 POST → 서명검증 후 응답.
// 상시봇(gateway) 아님 = 서버리스라 항상 켜져 있음(컴퓨터 꺼짐 무관).
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getStats, getAwards, listPersons, updatePerson, createPerson, addAccount,
  createQueue, getQueue, closeQueue, listSignups, getSignup, upsertSignup, removeSignup } from '../../../src/repo.js';
import { balance } from '../../../src/engine.js';
import { allocateQueue, LANES } from '../../../src/queue.js';
import { fetchTierEstimate } from '../../../src/opgg.js';
import { fetchTierEstimateHybrid, fetchRiotProfile, hasRiotKey } from '../../../src/riot.js';
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
const ephem = (content) => NextResponse.json({ type: 4, data: { content, flags: 64 } }); // 나만 보이는 답
const updateMsg = (data) => NextResponse.json({ type: 7, data }); // 버튼 눌린 메시지 갱신
const LANE_KR = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', sup: '서폿' };
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

// 티어 측정 (seed API와 동일 파이프라인): Riot키 있으면 하이브리드, 없으면 op.gg 단독
async function measureTier(name, tag, region) {
  if (hasRiotKey()) {
    try { const hy = await fetchTierEstimateHybrid(name, tag, region); if (hy.found) return hy; } catch { /* 폴백 */ }
  }
  const est = await fetchTierEstimate(name, tag, region);
  if (est.found) return est;
  if (hasRiotKey()) { const riot = await fetchRiotProfile(name, tag, region); if (riot.found) return riot; }
  return est;
}

// 슬래시 응답 뒤 결과를 원본 메시지에 채움(15분 유효). 봇토큰 불필요(interaction 토큰).
async function followup(i, content) {
  await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
}

// 신규 셀프 가입: 닉네임 → 우리 시스템이 티어 측정 → 카드 생성 + 연동. 측정 실패면 가입 거부.
// 측정이 3초를 넘겨(7초+) defer(type 5) 후 waitUntil로 백그라운드 처리 + followup.
async function processRegister(i) {
  try {
    const me = callerId(i);
    const persons = await listPersons(GID);
    const already = persons.find((p) => p.discord_id === me);
    if (already) return followup(i, `이미 **${already.nickname || already.display_name}** 으로 가입돼 있어요. 정보 수정은 웹 사람관리에서.`);
    const raw = (opt(i, '닉네임') || '').trim();
    const hash = raw.indexOf('#');
    const gameName = raw.slice(0, hash).trim();
    const tag = raw.slice(hash + 1).trim();
    if (!gameName || !tag) return followup(i, '❌ 라이엇 ID를 `게임닉#태그` 형식으로 정확히 입력하세요. 예: `홍길동#KR1`');
    const region = opt(i, '지역') || 'NA';
    const main = opt(i, '주라인');
    const sub = opt(i, '부라인');

    const est = await measureTier(gameName, tag, region);
    if (!est.found) return followup(i, `❌ "${raw}" (${region}) 을 못 찾았어요. 정확한 라이엇 ID(#태그 포함)와 지역을 확인하세요.`);
    if (!est.suggestedTier) return followup(i, `❌ "${raw}" 는 랭크 기록이 없어 티어 측정이 안 돼요(언랭). 솔랭 배치 후 다시 시도하세요.`);
    const tier = est.suggestedTier;
    const displayName = est.gameName || gameName;

    const key = normNm(displayName);
    const exist = persons.find((p) => normNm(p.display_name) === key || normNm(p.nickname || '') === key);
    if (exist && exist.discord_id) return followup(i, `"${displayName}" 이름은 이미 다른 사람이 연동돼 있어요. 관리자에게 문의.`);
    let personId;
    if (exist) { // 미연동 동명 카드 → 연결 + 측정 티어로 갱신
      await updatePerson(exist.id, { discord_id: me, base_tier: tier });
      personId = exist.id;
    } else {
      const secondary = sub && sub !== main ? [sub] : [];
      const p = await createPerson(GID, { display_name: displayName, base_tier: tier, primary_positions: [main], secondary_positions: secondary });
      await updatePerson(p.id, { discord_id: me });
      personId = p.id;
    }
    try { await addAccount({ person_id: personId, game_name: displayName, tag_line: tag, region, opgg_tier: tier, opgg_confidence: est.confidence }); } catch { /* 계정저장 실패는 무시 */ }
    const laneTxt = LANE_KR[main] + (sub && sub !== main ? ` / 부:${LANE_KR[sub]}` : '');
    return followup(i, `🎉 **${displayName}** 가입 완료!\n측정 티어 **${TIER_LABEL[tier] || tier}** · ${laneTxt}\n${est.basis ? `_${est.basis}_\n` : ''}이제 \`/내전적\`·\`/밸런스\`·\`/모집\`에서 인식돼요.`);
  } catch (e) { return followup(i, '가입 처리 중 오류: ' + e.message); }
}

async function cmdRegister(i) {
  const raw = (opt(i, '닉네임') || '').trim();
  if (!raw.includes('#')) return reply('❌ 라이엇 ID를 #태그까지 정확히 입력하세요. 예: `홍길동#KR1` (해시태그 없으면 측정 불가)');
  if (!opt(i, '주라인')) return reply('주라인을 선택하세요.');
  waitUntil(processRegister(i)); // 측정 7초+ → 백그라운드
  return NextResponse.json({ type: 5, data: { content: `🔎 **${raw}** 티어 측정 중… (몇 초 걸려요)` } }); // deferred
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

// ── 내전 모집 큐 ── 라인 선착순 + 부라인 밀림/연쇄/대기 (src/queue.js 알고리즘)
// 메시지 = 슬래시 응답으로 생성 → 이후 버튼 클릭은 그 메시지 위 → type 7 로 in-place 갱신(봇토큰 불필요)
function queueComponents(qid) {
  const btn = (custom_id, label, style) => ({ type: 2, style, label, custom_id });
  return [
    { type: 1, components: LANES.map((l) => btn(`qm:${qid}:${l}`, LANE_KR[l], 1)) }, // 메인 라인
    { type: 1, components: [{ type: 3, custom_id: `qs:${qid}`, placeholder: '부라인 선택 (선택 · 없어도 됨)',
      options: [{ label: '부라인 없음', value: 'none' }, ...LANES.map((l) => ({ label: LANE_KR[l], value: l }))] }] },
    { type: 1, components: [btn(`ql:${qid}`, '❌ 나가기', 4), btn(`qc:${qid}`, '🔒 마감', 2)] },
  ];
}

function queueData(queue, signups, closed) {
  const N = Math.max(1, Math.floor(queue.size / 5)); // 라인당 슬롯 (10인=2, 20인=4)
  const input = signups.map((s, idx) => ({ id: s.discord_id, main: s.main, sub: s.sub || null, order: idx }));
  const alloc = allocateQueue(input, queue.size);
  const info = new Map(signups.map((s) => [s.discord_id, s]));
  const lines = LANES.map((l) => {
    const ids = alloc.lanes[l];
    const names = ids.map((id) => { const s = info.get(id); return `${s?.name || '?'}${s && s.main !== l ? '(부)' : ''}`; });
    const dot = ids.length >= N ? '🔵' : (ids.length ? '🟢' : '⬜');
    return `${dot} **${LANE_KR[l]}** (${ids.length}/${N}) ${names.join(', ') || '—'}`;
  });
  const wait = alloc.waitlist.map((id) => info.get(id)?.name || '?');
  let desc = lines.join('\n');
  if (wait.length) desc += `\n\n⏳ **대기** (${wait.length}) ${wait.join(', ')}`;
  const embed = {
    title: `🎮 내전 모집 · ${queue.size}인${closed ? ' · 마감됨' : ` (${signups.length}/${queue.size})`}`,
    description: desc, color: GOLD,
    footer: closed ? undefined : { text: '메인 라인 버튼으로 참가 · 부라인은 드롭다운(선택) · 라인 다시 눌러 변경 · ❌ 나가기' },
  };
  return { embeds: [embed], components: closed ? [] : queueComponents(queue.id), allowed_mentions: { parse: [] } };
}

async function cmdRecruit(i) {
  const size = opt(i, '인원') === 20 ? 20 : 10;
  const q = await createQueue(GID, size, callerId(i));
  return NextResponse.json({ type: 4, data: queueData(q, [], false) });
}

async function handleComponent(i) {
  if (!GID) return ephem('⚠️ 방 설정(DISCORD_DEFAULT_GID)이 없어요.');
  const parts = (i.data?.custom_id || '').split(':');
  const [action, qid, lane] = parts;
  const queue = await getQueue(qid);
  if (!queue) return ephem('모집을 찾을 수 없어요 (오래된 메시지일 수 있어요).');
  if (queue.status !== 'open') return ephem('이미 마감된 모집이에요.');
  const me = callerId(i);

  if (action === 'qm') { // 메인 라인 선택/변경 → 참가
    const persons = await listPersons(GID);
    const meP = persons.find((p) => p.discord_id === me);
    if (!meP) return ephem('먼저 `/가입`(신규) 또는 `/연동`(기존 카드)으로 등록해야 참가할 수 있어요. (팀 밸런스에 티어가 필요해요)');
    const ex = await getSignup(qid, me);
    const patch = { main: lane };
    if (ex?.sub === lane) patch.sub = null; // 부라인이 새 메인과 겹치면 해제
    if (!ex) patch.name = meP.nickname || meP.display_name; // 등록 이름으로 표시
    await upsertSignup(qid, me, patch);
  } else if (action === 'qs') { // 부라인 드롭다운
    const ex = await getSignup(qid, me);
    if (!ex) return ephem('먼저 메인 라인을 선택하세요.');
    const val = i.data?.values?.[0] || 'none';
    if (val !== 'none' && val === ex.main) return ephem('메인이랑 같은 라인은 부라인이 안 돼요.');
    await upsertSignup(qid, me, { sub: val === 'none' ? null : val });
  } else if (action === 'ql') { // 나가기
    await removeSignup(qid, me);
  } else if (action === 'qc') { // 마감 (만든 사람만)
    if (queue.host_id && me !== queue.host_id) return ephem('모집 만든 사람만 마감할 수 있어요.');
    await closeQueue(qid);
    return updateMsg(queueData({ ...queue, status: 'closed' }, await listSignups(qid), true));
  } else {
    return ephem('알 수 없는 버튼이에요.');
  }
  return updateMsg(queueData(queue, await listSignups(qid), false));
}

const HANDLERS = { 리더보드: cmdLeaderboard, 전적: cmdRecord, 내전적: cmdMyRecord, 연동: cmdLink, 가입: cmdRegister, 칭호: cmdAwards, 방: cmdRoom, 밸런스: cmdBalance, 모집: cmdRecruit };

export async function POST(request) {
  const body = await request.text();
  if (!verifySignature(request.headers.get('x-signature-ed25519'), request.headers.get('x-signature-timestamp'), body)) {
    return new NextResponse('invalid request signature', { status: 401 });
  }
  const i = JSON.parse(body);
  if (i.type === 1) return NextResponse.json({ type: 1 }); // PING → PONG
  if (i.type === 2) { // 슬래시 커맨드
    if (!GID) return reply('⚠️ 방 설정(DISCORD_DEFAULT_GID)이 없어요.');
    const h = HANDLERS[i.data?.name];
    if (!h) return reply('알 수 없는 명령어예요.');
    try { return await h(i); } catch (e) { return reply('오류: ' + e.message); }
  }
  if (i.type === 3) { // 버튼·드롭다운 (모집 큐)
    try { return await handleComponent(i); } catch (e) { return ephem('오류: ' + e.message); }
  }
  return NextResponse.json({ type: 4, data: { content: '지원하지 않는 인터랙션' } });
}
