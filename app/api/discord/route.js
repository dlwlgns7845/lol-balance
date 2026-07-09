// Discord 인터랙션 엔드포인트 (슬래시 커맨드). Discord가 여기로 POST → 서명검증 후 응답.
// 상시봇(gateway) 아님 = 서버리스라 항상 켜져 있음(컴퓨터 꺼짐 무관).
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getStats, getAwards, getMatchHistory, listPersons, updatePerson, createPerson, addAccount, uploadAvatarFromUrl, saveMatch,
  createQueue, getQueue, closeQueue, listSignups, getSignup, upsertSignup, removeSignup, setQueueMessage,
  createPending, getPending, updatePending, deletePending,
  getGuildRoom, getGuildLink, requestGuildLink, getGroupByCode } from '../../../src/repo.js';
import { balance, balance20Split } from '../../../src/engine.js';
import { LANES } from '../../../src/queue.js';
import { queueMessage, buildTeams, buildTeamsRanked, allocateSignups, LANE_KR } from '../../../src/discord-queue.js';
import { extractScoreboard } from '../../../src/vision.js';
import { fetchTierEstimate } from '../../../src/opgg.js';
import { fetchTierEstimateHybrid, fetchRiotProfile, hasRiotKey } from '../../../src/riot.js';
import { TIER_LABEL, POS_KR } from '../../../src/table.js';

export const runtime = 'nodejs';
export const maxDuration = 60; // 스샷 OCR(gpt-4o) + 저장 여유

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const GOLD = 0xe8c07d;

// 이 서버(guild)가 연결한 방. 연결 안 됐으면 null → 커맨드가 /방연결 안내. (빙수 포함 모든 서버 명시적 연결)
async function resolveGid(i) {
  if (!i?.guild_id) return null;
  return await getGuildRoom(i.guild_id);
}
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
const callerId = (i) => i.member?.user?.id || i.user?.id;
const discordUser = (i) => i.member?.user || i.user;
const opt = (i, name) => (i.data?.options || []).find((o) => o.name === name)?.value;

// 디코 프로필 사진 URL (커스텀 없으면 기본 아바타)
function discordAvatarUrl(u) {
  if (!u?.id) return null;
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`;
  let idx = 0;
  try { idx = u.discriminator && u.discriminator !== '0' ? Number(u.discriminator) % 5 : Number((BigInt(u.id) >> 22n) % 6n); } catch { idx = 0; }
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}
// 연동/가입 시 디코 사진을 기본 아바타로 세팅 (기존 색/이모지는 유지). profile 컬럼 없으면 조용히 스킵.
async function setDiscordAvatar(person, i) {
  try {
    const url = discordAvatarUrl(discordUser(i));
    if (url) await updatePerson(person.id, { profile: { ...(person.profile || {}), avatar: url } });
  } catch { /* profile 컬럼 미반영 → 링크 자체는 유지 */ }
}
const wr = (w) => `${Math.round((w || 0) * 100)}%`;
const posLabel = (p) => (p ? POS_KR[p] : '-');

// ── 커맨드 핸들러 ──
async function cmdLeaderboard(i, gid) {
  const { players } = await getStats(gid);
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

async function cmdRecord(i, gid) {
  const q = normNm(opt(i, '선수') || '');
  if (!q) return reply('선수 이름을 입력하세요.');
  const { players } = await getStats(gid);
  const hit = players.filter((p) => p.games > 0).find((p) => normNm(p.nickname || p.name) === q)
    || players.filter((p) => p.games > 0).find((p) => normNm(p.nickname || p.name).includes(q));
  if (!hit) return reply(`"${opt(i, '선수')}" 선수를 못 찾았어요.`);
  return embed(playerEmbed(hit));
}

async function cmdMyRecord(i, gid) {
  const persons = await listPersons(gid);
  const me = persons.find((p) => p.discord_id === callerId(i));
  if (!me) return reply('아직 연동 안 됐어요. `/연동 선수:내닉` 으로 먼저 연결하세요.');
  const { players } = await getStats(gid);
  const p = players.find((x) => x.id === me.id);
  if (!p || !p.games) return reply('연동은 됐는데 아직 기록이 없어요.');
  return embed(playerEmbed(p));
}

async function cmdLink(i, gid) {
  const q = normNm(opt(i, '선수') || '');
  if (!q) return reply('연동할 선수 이름을 입력하세요.');
  const persons = await listPersons(gid);
  const target = persons.find((p) => normNm(p.display_name) === q || normNm(p.nickname || '') === q)
    || persons.find((p) => normNm(p.display_name).includes(q));
  if (!target) return reply(`"${opt(i, '선수')}" 선수를 못 찾았어요. 사람관리에 등록된 이름으로.`);
  await updatePerson(target.id, { discord_id: callerId(i) });
  await setDiscordAvatar(target, i); // 기본 아바타 = 디코 프로필 사진
  return reply(`✅ <@${callerId(i)}> ↔ **${target.display_name}** 연동 완료! 아바타는 디코 프로필 사진으로 설정됐어요 (\`/프로필\`로 변경 가능). 이제 \`/내전적\`·\`/밸런스\`에서 자동 인식돼요.`);
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
// followup 인데 embed/버튼까지 (스샷 판독 확인용)
async function followupData(i, data) {
  await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...data }),
  });
}

// 신규 셀프 가입: 닉네임 → 우리 시스템이 티어 측정 → 카드 생성 + 연동. 측정 실패면 가입 거부.
// 측정이 3초를 넘겨(7초+) defer(type 5) 후 waitUntil로 백그라운드 처리 + followup.
async function processRegister(i, gid) {
  try {
    const me = callerId(i);
    const persons = await listPersons(gid);
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
      const p = await createPerson(gid, { display_name: displayName, base_tier: tier, primary_positions: [main], secondary_positions: secondary });
      await updatePerson(p.id, { discord_id: me });
      personId = p.id;
    }
    try { await addAccount({ person_id: personId, game_name: displayName, tag_line: tag, region, opgg_tier: tier, opgg_confidence: est.confidence }); } catch { /* 계정저장 실패는 무시 */ }
    await setDiscordAvatar({ id: personId, profile: exist?.profile || null }, i); // 기본 아바타 = 디코 프로필 사진
    const laneTxt = LANE_KR[main] + (sub && sub !== main ? ` / 부:${LANE_KR[sub]}` : '');
    return followup(i, `🎉 **${displayName}** 가입 완료!\n측정 티어 **${TIER_LABEL[tier] || tier}** · ${laneTxt}\n${est.basis ? `_${est.basis}_\n` : ''}아바타는 디코 프로필 사진 (\`/프로필\`로 변경). 이제 \`/내전적\`·\`/밸런스\`·\`/모집\`에서 인식돼요.`);
  } catch (e) { return followup(i, '가입 처리 중 오류: ' + e.message); }
}

async function cmdRegister(i, gid) {
  const raw = (opt(i, '닉네임') || '').trim();
  if (!raw.includes('#')) return reply('❌ 라이엇 ID를 #태그까지 정확히 입력하세요. 예: `홍길동#KR1` (해시태그 없으면 측정 불가)');
  if (!opt(i, '주라인')) return reply('주라인을 선택하세요.');
  waitUntil(processRegister(i, gid)); // 측정 7초+ → 백그라운드
  return NextResponse.json({ type: 5, data: { content: `🔎 **${raw}** 티어 측정 중… (몇 초 걸려요)` } }); // deferred
}

// 업로드 사진 → Supabase Storage 재호스팅 (디코 첨부는 만료). 느려서 defer 후 처리.
async function processProfilePhoto(i, photoId, gid) {
  try {
    const me = callerId(i);
    const persons = await listPersons(gid);
    const meP = persons.find((p) => p.discord_id === me);
    if (!meP) return followup(i, '먼저 `/가입` 또는 `/연동` 하세요.');
    const att = i.data?.resolved?.attachments?.[photoId];
    if (!att || !(att.content_type || '').startsWith('image/')) return followup(i, '❌ 이미지 파일만 올릴 수 있어요.');
    if (att.size > 4 * 1024 * 1024) return followup(i, '❌ 이미지가 너무 커요 (4MB 이하로).');
    let url;
    try { url = await uploadAvatarFromUrl(meP.id, att.url, att.content_type); }
    catch (e) { return followup(i, '사진 저장 실패: ' + e.message + ' (관리자에게 profile 컬럼/스토리지 확인 요청)'); }
    if (!url) return followup(i, '사진 저장 실패 — 잠시 후 다시 시도하세요.');
    const profile = { ...(meP.profile || {}), avatar: `${url}?v=${Date.now()}` };
    delete profile.color; delete profile.emoji; // 사진 보이게 커스텀 제거
    try { await updatePerson(meP.id, { profile }); }
    catch { return followup(i, '프로필 저장 실패 — 관리자에게 `profile` 컬럼 추가를 요청하세요.'); }
    return followup(i, `✅ **${meP.nickname || meP.display_name}** 프로필 사진 업데이트! 사이트 아바타에 반영돼요.`);
  } catch (e) { return followup(i, '사진 처리 오류: ' + e.message); }
}

// 셀프 프로필: 기본=디코 프로필 사진, 사진 업로드/색/이모지로 커스텀. 디코사진=true면 사진으로 되돌림.
async function cmdProfile(i, gid) {
  const photoId = opt(i, '사진'); // 첨부 업로드 → 재호스팅(느림) → defer
  if (photoId) { waitUntil(processProfilePhoto(i, photoId, gid)); return NextResponse.json({ type: 5, data: { content: '📷 프로필 사진 저장 중…' } }); }
  const me = callerId(i);
  const persons = await listPersons(gid);
  const meP = persons.find((p) => p.discord_id === me);
  if (!meP) return reply('먼저 `/가입`(신규) 또는 `/연동`(기존)으로 등록하세요.');
  const useDiscord = opt(i, '디코사진') === true;
  const color = opt(i, '색');
  const emoji = opt(i, '이모지');
  const avatar = discordAvatarUrl(discordUser(i));
  let profile;
  if (useDiscord) {
    profile = { avatar }; // 색/이모지 제거 → 사진 표시
  } else {
    profile = { ...(meP.profile || {}), avatar: (meP.profile?.avatar || avatar) };
    if (color) profile.color = color;
    if (emoji != null) { if (emoji === '없음' || emoji === '') delete profile.emoji; else profile.emoji = emoji; }
    if (!color && emoji == null && !meP.profile) profile = { avatar }; // 옵션 없이 첫 호출 = 사진 세팅
  }
  try { await updatePerson(meP.id, { profile }); }
  catch { return reply('프로필 저장 실패 — 관리자에게 `profile` 컬럼 추가를 요청하세요.'); }
  const how = (profile.color || profile.emoji) ? '커스텀(색/이모지)' : '디코 프로필 사진';
  return reply(`✅ **${meP.nickname || meP.display_name}** 프로필 업데이트 → ${how}. 사이트 아바타에 바로 반영돼요.`);
}

async function cmdAwards(i, gid) {
  const a = await getAwards(gid);
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

async function cmdRoom(i, gid) {
  const st = await getStats(gid);
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

function balanceView(candidates, idx, pendingId) {
  const c = candidates[idx];
  const side = (T) => c.lanes.map((l) => { const x = l[T]; return `${POS_KR[l.pos]} · ${x.name} (${TIER_LABEL[x.tier] || x.tier})`; }).join('\n');
  const light = { green: '🟢 균형', yellow: '🟡 약간 기움', red: '🔴 불균형' }[c.light];
  return {
    embeds: [{
      title: '⚔️ 팀 밸런스', description: `${light} · 총점차 ${c.totalDiff.toFixed(1)} · 조합 #${idx + 1}/${candidates.length}`, color: GOLD,
      fields: [
        { name: `🔵 블루 (${c.sumA.toFixed(0)})`, value: side('a'), inline: true },
        { name: `🔴 레드 (${c.sumB.toFixed(0)})`, value: side('b'), inline: true },
      ],
    }],
    components: candidates.length > 1 ? [{ type: 1, components: [{ type: 2, style: 1, label: '🎲 다시 짜기', custom_id: `br:${pendingId}:${idx}` }] }] : [],
    allowed_mentions: { parse: [] },
  };
}

async function cmdBalance(i, gid) {
  const raw = opt(i, '명단') || '';
  const ids = [...raw.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]);
  if (ids.length !== 10) return reply(`10명을 멘션하세요 (현재 ${ids.length}명). 예: \`/밸런스 명단:@a @b … @j\``);
  const persons = await listPersons(gid);
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
  const pendingId = await createPending(gid, { type: 'balance', players });
  return NextResponse.json({ type: 4, data: balanceView(r.candidates, 0, pendingId) });
}

// /밸런스 리롤: 저장된 명단으로 재계산 → 다음 후보 순환
async function handleBalanceReroll(pendingId, curIdxStr) {
  const pend = await getPending(pendingId);
  if (!pend || pend.data?.type !== 'balance') return ephem('⌛ 만료된 밸런스예요. 다시 `/밸런스` 해주세요.');
  const r = balance(pend.data.players, {});
  if (!r.feasible || !r.candidates?.length) return ephem('팀을 다시 짤 수 없어요.');
  const nextIdx = (Number(curIdxStr || 0) + 1) % r.candidates.length;
  return updateMsg(balanceView(r.candidates, nextIdx, pendingId));
}

// ── 내전 모집 큐 ── 라인 선착순 + 부라인 밀림/연쇄/대기. 렌더는 src/discord-queue.js 공유(사이트와 동일).
// 메시지 = 슬래시 응답으로 생성 → 버튼 클릭은 그 메시지 위 type7 갱신. 사이트→디코는 저장된 message_id 로 PATCH.
async function captureMessageId(i, queueId) {
  try { // 슬래시 응답이 만든 메시지 ID를 @original 로 조회해 저장 (사이트에서 그 메시지를 갱신하려면 필요)
    const r = await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`);
    if (!r.ok) return;
    const msg = await r.json();
    if (msg?.id) await setQueueMessage(queueId, i.channel_id, msg.id);
  } catch { /* 실패해도 디코 버튼은 동작(type7). 사이트→디코만 안 됨 */ }
}

async function cmdRecruit(i, gid) {
  const size = opt(i, '인원') === 20 ? 20 : 10;
  const q = await createQueue(gid, size, callerId(i), i.channel_id);
  waitUntil(captureMessageId(i, q.id));
  return NextResponse.json({ type: 4, data: queueMessage(q, [], false) });
}

// 20인 마감 → 고저분리 4팀 (파워순 상위10/하위10 → 각 로비 균형). 20명 배정·포지션 있어야, 아니면 null.
function autoTeams20(queue, signups, persons) {
  const alloc = allocateSignups(queue, signups);
  const placedIds = LANES.flatMap((l) => alloc.lanes[l]);
  if (placedIds.length !== 20) return null;
  const byD = new Map(persons.filter((p) => p.discord_id).map((p) => [p.discord_id, p]));
  const byId = new Map(persons.map((p) => [p.id, p]));
  const players = [];
  for (const did of placedIds) {
    const person = did.startsWith('site:') ? byId.get(did.slice(5)) : byD.get(did);
    if (!person) return null;
    const positions = [...(person.primary_positions || []), ...(person.secondary_positions || [])];
    if (!positions.length) return null; // 포지션 미지정 = 자동팀 불가
    players.push({ name: person.nickname || person.display_name, tier: person.base_tier, secondaryTier: person.secondary_tier || null, positions, primary: person.primary_positions || [] });
  }
  try { return balance20Split(players); } catch { return null; }
}

// 마감 시 신청자 전원을 태그해 호출 (새 followup 메시지 = 실제 알림 발생). site: 키는 태그 못하니 이름만.
async function pingTeams(i, signups, teams) {
  const ids = signups.map((s) => s.discord_id).filter((id) => id && !id.startsWith('site:'));
  const tag = (p) => (p.discordId && !p.discordId.startsWith('site:') ? `<@${p.discordId}>` : p.name);
  let content;
  if (teams) {
    const side = (arr) => arr.map((p) => `${LANE_KR[p.lane]} ${tag(p)}`).join(' · ');
    content = `🎮 **내전 시작!** 팀 확정 — 모두 모여요!\n🟦 **블루** ${side(teams.A)}\n🟥 **레드** ${side(teams.B)}`;
  } else {
    if (!ids.length) return;
    content = `🎮 **내전 마감!** 모두 모여요 — ${ids.map((id) => `<@${id}>`).join(' ')}`;
  }
  try {
    await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { users: ids.slice(0, 100) } }),
    });
  } catch { /* 호출 실패해도 마감·팀은 유지 */ }
}

async function handleComponent(i) {
  const parts = (i.data?.custom_id || '').split(':');
  const [action, qid, lane] = parts;
  if (action === 'tr') return handleTeamReroll(qid, lane); // 마감 자동팀 리롤 (lane=현재idx)
  if (action === 'br') return handleBalanceReroll(qid, lane); // /밸런스 리롤 (lane=현재idx)
  if (action === 'rec' || action === 'rex') return handleRecordConfirm(i, action, qid); // 스샷 판독 확인/취소
  if (action === 'rswap') return handleRecordSwap(qid); // 승패 뒤집기
  if (action === 'rdur') return handleRecordDurOpen(i, qid); // 시간 수정 모달
  if (action === 'redit') return handleRecordEditOpen(i, qid); // 선수 값수정 모달
  if (action === 'rmap') return handleRecordMapOpen(i, qid); // 🆕 → 기존선수 지정 열기
  if (action === 'rmapto') return handleRecordMapTo(i, qid, lane); // 지정 완료 (lane=idx)
  if (action === 'rback') { const pd = await getPending(qid); return pd ? updateMsg(await reviewData(pd)) : updateMsg({ content: '⌛ 만료된 판독이에요.', embeds: [], components: [] }); }
  const queue = await getQueue(qid);
  if (!queue) return ephem('모집을 찾을 수 없어요 (오래된 메시지일 수 있어요).');
  if (queue.status !== 'open') return ephem('이미 마감된 모집이에요.');
  const me = callerId(i);

  if (action === 'qm') { // 메인 라인 선택/변경 → 참가
    const persons = await listPersons(queue.gid);
    const meP = persons.find((p) => p.discord_id === me);
    if (!meP) return ephem('먼저 `/가입`(신규) 또는 `/연동`(기존 카드)으로 등록해야 참가할 수 있어요. (팀 밸런스에 티어가 필요해요)');
    const ex = await getSignup(qid, me);
    const patch = { main: lane };
    if (lane === 'all') patch.sub = null; // 주라인 ALL이면 부라인 무의미 → 해제
    else if (ex?.sub === lane) patch.sub = null; // 부라인이 새 메인과 겹치면 해제
    if (!ex) patch.name = meP.nickname || meP.display_name; // 등록 이름으로 표시
    await upsertSignup(qid, me, patch);
  } else if (action === 'qs') { // 부라인 드롭다운
    const ex = await getSignup(qid, me);
    if (!ex) return ephem('먼저 메인 라인을 선택하세요.');
    const val = i.data?.values?.[0] || 'none';
    if (val !== 'none' && val !== 'all' && val === ex.main) return ephem('메인이랑 같은 라인은 부라인이 안 돼요.');
    await upsertSignup(qid, me, { sub: val === 'none' ? null : val });
  } else if (action === 'ql') { // 나가기
    await removeSignup(qid, me);
  } else if (action === 'qc') { // 마감 (만든 사람만) → 자동팀 + 신청자 태그 호출
    if (queue.host_id && me !== queue.host_id) return ephem('모집 만든 사람만 마감할 수 있어요.');
    await closeQueue(qid);
    const signups = await listSignups(qid);
    const persons = await listPersons(queue.gid);
    if (queue.size === 20) { // 고저분리 4팀
      const teams20 = autoTeams20({ ...queue, status: 'closed' }, signups, persons);
      waitUntil(pingTeams(i, signups, null)); // 전원 태그(4팀은 메시지에 표시)
      return updateMsg(queueMessage({ ...queue, status: 'closed' }, signups, true, null, 0, teams20));
    }
    const pmap = new Map(persons.filter((p) => p.discord_id).map((p) => [p.discord_id, { tier: p.base_tier, secondaryTier: p.secondary_tier || null }]));
    const teams = buildTeams({ ...queue, status: 'closed' }, signups, pmap);
    waitUntil(pingTeams(i, signups, teams)); // 태그해서 부르기(새 메시지 = 알림 뜸)
    return updateMsg(queueMessage({ ...queue, status: 'closed' }, signups, true, teams));
  } else {
    return ephem('알 수 없는 버튼이에요.');
  }
  return updateMsg(queueMessage(queue, await listSignups(qid), false));
}

// ── 스샷 자동 전적기록 ── 로비 종료 스코어보드 → gpt-4o OCR → saveMatch(자동 사람등록+중복검사)
async function processMatchShot(i, photoId, gid) {
  try {
    const att = i.data?.resolved?.attachments?.[photoId];
    if (!att || !(att.content_type || '').startsWith('image/')) return followup(i, '❌ 이미지(스코어보드 스샷)를 올려주세요.');
    if (att.size > 8 * 1024 * 1024) return followup(i, '❌ 이미지가 너무 커요 (8MB 이하).');
    const res = await fetch(att.url);
    if (!res.ok) return followup(i, '이미지 다운로드 실패, 다시 시도하세요.');
    const buf = Buffer.from(await res.arrayBuffer());
    const dataUrl = `data:${att.content_type};base64,${buf.toString('base64')}`;

    let parsed;
    try { parsed = await extractScoreboard(dataUrl); }
    catch (e) { return followup(i, '스샷 판독 실패: ' + e.message); }
    const teams = parsed?.teams;
    if (!Array.isArray(teams) || teams.length !== 2 || teams.some((t) => !Array.isArray(t.players) || t.players.length !== 5)) {
      return followup(i, '❌ 스코어보드를 제대로 못 읽었어요. **로비 종료 스코어보드 전체**(10명)가 다 보이게 다시 찍어 올려주세요.');
    }
    const [t1, t2] = teams;
    const winner = t1.win ? 'A' : (t2.win ? 'B' : 'A');
    const mk = (pl, team) => ({ name: (pl.name || '').trim(), team, champion: pl.champion || null, k: pl.k, d: pl.d, a: pl.a, damage: pl.damage, cs: pl.cs, gold: pl.gold });
    const participants = [...t1.players.map((p) => mk(p, 'A')), ...t2.players.map((p) => mk(p, 'B'))];
    if (participants.some((p) => !p.name)) return followup(i, '❌ 소환사명을 다 못 읽었어요. 이름이 가려지지 않게 다시 찍어주세요.');

    // 바로 저장 X — 판독 결과를 보여주고 확인/수정받음 (OCR 오독 방지). 임시 보관.
    const pendingId = await createPending(gid, { winner, participants, durationMin: parsed.durationMin });
    return followupData(i, await reviewData({ id: pendingId, gid, data: { winner, participants, durationMin: parsed.durationMin } }));
  } catch (e) { return followup(i, '기록 처리 오류: ' + e.message); }
}

const LANE_TAG = ['TOP', 'JG', 'MID', 'BOT', 'SUP']; // 스샷 슬롯 순서

// 마감 자동팀 리롤: 같은 로스터로 다음 균형 조합(랭킹 순환)
async function handleTeamReroll(qid, curIdxStr) {
  const queue = await getQueue(qid);
  if (!queue) return ephem('⌛ 만료된 모집이에요.');
  const signups = await listSignups(qid);
  const persons = await listPersons(queue.gid);
  const pmap = new Map(persons.filter((p) => p.discord_id).map((p) => [p.discord_id, { tier: p.base_tier, secondaryTier: p.secondary_tier || null }]));
  const ranked = buildTeamsRanked({ ...queue, status: 'closed' }, signups, pmap);
  if (!ranked.length) return ephem('팀을 다시 짤 수 없어요 (10인 아님).');
  const nextIdx = (Number(curIdxStr || 0) + 1) % ranked.length;
  return updateMsg(queueMessage({ ...queue, status: 'closed' }, signups, true, ranked[nextIdx], nextIdx));
}

// 판독 리뷰 메시지(embed + 셀렉트/버튼) — 초기 표시·수정 후 재렌더 공용.
// mapSlot 지정 시: 그 자리를 "기존 선수로 지정"하는 person 셀렉트를 보여줌.
async function reviewData(pend, mapSlot) {
  const persons = await listPersons(pend.gid);
  const known = new Set(persons.flatMap((p) => [p.display_name, p.nickname].filter(Boolean).map(normNm)));
  const { winner, participants, durationMin } = pend.data;
  const isMapped = (p) => !!p.person_id || known.has(normNm(p.name));
  const teamField = (team, blue) => {
    const list = participants.filter((x) => x.team === team);
    const val = list.map((p, li) => {
      const kda = `\`${p.k ?? 0}/${p.d ?? 0}/${p.a ?? 0}\``;
      const econ = p.cs ? `${p.cs}cs` : (p.gold ? `${p.gold}g` : '-');
      const dmg = p.damage ? ` · ${Math.round(p.damage / 1000)}k` : '';
      return `\`${LANE_TAG[li] || '·'}\` ${isMapped(p) ? '' : '🆕'}**${p.name}**\n　${p.champion || '?'} · ${kda} · ${econ}${dmg}`;
    }).join('\n');
    return { name: `${blue ? '🟦' : '🟥'} 팀 ${blue ? '1 · 블루' : '2 · 레드'}${(blue ? winner === 'A' : winner === 'B') ? '　🏆 승리' : ''}`, value: val || '—', inline: true };
  };
  const embed = {
    title: '📋 판독 결과 — 확인·수정 후 저장', color: winner === 'A' ? 0x4d7de8 : 0xe84d4d,
    fields: [teamField('A', true), teamField('B', false)],
    footer: { text: `${durationMin ? Math.round(durationMin) + '분 · ' : ''}🆕=미등록(저장 시 자동생성) · 정렬: 탑>정글>미드>원딜>서폿` },
  };

  if (mapSlot != null) { // 기존 선수로 지정 모드
    const p = participants[mapSlot];
    const opts = persons.slice(0, 25).map((x) => ({ label: (x.nickname || x.display_name || '?').slice(0, 90), value: x.id, description: (TIER_LABEL[x.base_tier] || x.base_tier || '').slice(0, 90) }));
    embed.footer = { text: `"${p?.name}" → 어느 기존 선수인가요? (아래 목록${persons.length > 25 ? ' · 상위25명' : ''})` };
    return { content: '', embeds: [embed], components: [
      { type: 1, components: [{ type: 3, custom_id: `rmapto:${pend.id}:${mapSlot}`, placeholder: '🔗 이 자리를 어느 기존 선수로?', options: opts.length ? opts : [{ label: '(등록된 선수 없음)', value: 'none' }] }] },
      { type: 1, components: [{ type: 2, style: 2, label: '← 취소', custom_id: `rback:${pend.id}` }] },
    ] };
  }

  const newSlots = participants.map((p, idx) => ({ p, idx })).filter((x) => !isMapped(x.p));
  const editOpts = participants.map((p, idx) => ({ label: `${p.team === 'A' ? '1팀' : '2팀'} ${LANE_TAG[idx % 5]} ${p.name}`.slice(0, 90), value: String(idx), description: `${p.champion || ''} ${p.k ?? 0}/${p.d ?? 0}/${p.a ?? 0}`.slice(0, 90) }));
  const components = [
    { type: 1, components: [{ type: 3, custom_id: `redit:${pend.id}`, placeholder: '✏️ 값 수정할 선수 선택', options: editOpts }] },
  ];
  if (newSlots.length) components.push({ type: 1, components: [{ type: 3, custom_id: `rmap:${pend.id}`, placeholder: '🔗 미등록(🆕) → 기존 선수로 지정', options: newSlots.map((x) => ({ label: `${x.p.name}`.slice(0, 90), value: String(x.idx), description: `${x.p.champion || ''}`.slice(0, 90) })) }] });
  components.push({ type: 1, components: [
    { type: 2, style: 3, label: '✅ 저장', custom_id: `rec:${pend.id}` },
    { type: 2, style: 1, label: '🔄 승패', custom_id: `rswap:${pend.id}` },
    { type: 2, style: 2, label: '⏱ 시간', custom_id: `rdur:${pend.id}` },
    { type: 2, style: 4, label: '❌ 취소', custom_id: `rex:${pend.id}` },
  ] });
  return { content: '', embeds: [embed], components };
}

// 리더보드 TOP5 사람ID (3판+ · 점수순) — 순위변동 비교용
async function topIds(gid) {
  try { return (await getStats(gid)).players.filter((p) => p.games >= 3).sort((a, b) => b.score - a.score).slice(0, 5).map((p) => p.id); } catch { return []; }
}

// 경기 저장 후 채널에 결과+MVP+순위변동 공지 (새 메시지). 백그라운드.
async function announceResult(i, gid, beforeTop) {
  try {
    const lines = [];
    const { matches } = await getMatchHistory(gid, 1);
    const m = matches?.[0];
    if (m) {
      const winName = m.winner === 'A' ? '팀1(위)' : '팀2(아래)';
      lines.push(`🏆 **${winName} 승리!**　⚔️ ${m.killsA} : ${m.killsB}`);
      const all = [...m.A, ...m.B];
      const mvp = all.find((p) => p.mvp), ace = all.find((p) => p.ace);
      if (mvp) lines.push(`🏅 MVP **${mvp.name}**${mvp.champion ? ` · ${mvp.champion} ${mvp.k}/${mvp.d}/${mvp.a}` : ''}`);
      if (ace) lines.push(`⭐ ACE ${ace.name}${ace.champion ? ` · ${ace.champion} ${ace.k}/${ace.d}/${ace.a}` : ''}`);
    }
    // 순위 변동
    const afterTop = (await getStats(gid)).players.filter((p) => p.games >= 3).sort((a, b) => b.score - a.score).slice(0, 5);
    const beforeSet = new Set(beforeTop);
    const changes = [];
    if (afterTop[0] && beforeTop[0] && afterTop[0].id !== beforeTop[0]) changes.push(`👑 새 1위 **${afterTop[0].nickname || afterTop[0].name}**`);
    afterTop.forEach((p, idx) => { if (!beforeSet.has(p.id)) changes.push(`📈 ${p.nickname || p.name} TOP5 진입(#${idx + 1})`); });
    if (changes.length) lines.push('', `📊 ${changes.join(' · ')}`);
    if (!lines.length) return;
    await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: lines.join('\n'), allowed_mentions: { parse: [] } }),
    });
  } catch { /* 공지 실패해도 저장은 유지 */ }
}

// 판독 확인/취소
async function handleRecordConfirm(i, action, pendingId) {
  const pend = await getPending(pendingId);
  if (!pend) return updateMsg({ content: '⌛ 만료됐거나 이미 처리된 판독이에요.', embeds: [], components: [] });
  if (action === 'rex') { await deletePending(pendingId); return updateMsg({ content: '❌ 취소했어요 (저장 안 함).', embeds: [], components: [] }); }
  try {
    const beforeTop = await topIds(pend.gid); // 저장 전 순위 스냅샷
    const r = await saveMatch(pend.gid, pend.data);
    await deletePending(pendingId);
    if (r?.duplicate) return updateMsg({ content: '⚠️ 이미 기록된 경기예요 (중복). 저장 안 함.', embeds: [], components: [] });
    waitUntil(announceResult(i, pend.gid, beforeTop)); // 결과+MVP+순위변동 공지
    const winName = pend.data.winner === 'A' ? '팀1(위)' : '팀2(아래)';
    return updateMsg({ content: `✅ **저장 완료!** ${winName} 승리 · 통계·리더보드·칭호에 반영됐어요.`, embeds: [], components: [] });
  } catch (e) { return updateMsg({ content: '저장 오류: ' + e.message, embeds: [], components: [] }); }
}

// 승패 뒤집기
async function handleRecordSwap(pendingId) {
  const pend = await getPending(pendingId);
  if (!pend) return updateMsg({ content: '⌛ 만료된 판독이에요.', embeds: [], components: [] });
  pend.data.winner = pend.data.winner === 'A' ? 'B' : 'A';
  await updatePending(pendingId, pend.data);
  return updateMsg(await reviewData(pend));
}

// 🆕 선수 선택 → 기존 선수 지정 셀렉트 표시
async function handleRecordMapOpen(i, pendingId) {
  const pend = await getPending(pendingId);
  if (!pend) return updateMsg({ content: '⌛ 만료된 판독이에요.', embeds: [], components: [] });
  const idx = Number(i.data?.values?.[0]);
  return updateMsg(await reviewData(pend, idx));
}

// 기존 선수 지정 완료 → person_id 연결 후 리뷰로 복귀
async function handleRecordMapTo(i, pendingId, idxStr) {
  const pend = await getPending(pendingId);
  if (!pend) return updateMsg({ content: '⌛ 만료된 판독이에요.', embeds: [], components: [] });
  const personId = i.data?.values?.[0];
  const idx = Number(idxStr);
  if (personId && personId !== 'none' && pend.data.participants[idx]) {
    const persons = await listPersons(pend.gid);
    const person = persons.find((p) => p.id === personId);
    if (person) { pend.data.participants[idx].person_id = person.id; pend.data.participants[idx].name = person.nickname || person.display_name; }
    await updatePending(pendingId, pend.data);
  }
  return updateMsg(await reviewData(pend));
}

// 선수 선택 → 수정 모달 열기
async function handleRecordEditOpen(i, pendingId) {
  const pend = await getPending(pendingId);
  if (!pend) return ephem('⌛ 만료된 판독이에요. 다시 `/기록` 해주세요.');
  const idx = Number(i.data?.values?.[0]);
  const p = pend.data.participants[idx];
  if (!p) return ephem('선수를 못 찾았어요.');
  const input = (id, label, value) => ({ type: 1, components: [{ type: 4, custom_id: id, label, style: 1, value: String(value ?? ''), required: false }] });
  return NextResponse.json({ type: 9, data: {
    custom_id: `rmod:${pendingId}:${idx}`, title: `${(p.name || '선수').slice(0, 40)} 수정`,
    components: [
      input('name', '소환사명', p.name || ''),
      input('champ', '챔피언', p.champion || ''),
      input('kda', 'K/D/A (예: 12/3/8)', `${p.k ?? 0}/${p.d ?? 0}/${p.a ?? 0}`),
      input('dmg', '딜량', p.damage ?? 0),
      input('cs', 'CS', p.cs ?? 0),
    ],
  } });
}

// 게임 시간(분) 수정 모달 열기
async function handleRecordDurOpen(i, pendingId) {
  const pend = await getPending(pendingId);
  if (!pend) return ephem('⌛ 만료된 판독이에요.');
  return NextResponse.json({ type: 9, data: {
    custom_id: `rdmod:${pendingId}`, title: '게임 시간 수정',
    components: [{ type: 1, components: [{ type: 4, custom_id: 'dur', label: '게임 시간 (분, 예: 27.5)', style: 1, value: String(pend.data.durationMin || 0), required: false }] }],
  } });
}

// 모달 제출 → 시간(rdmod) 또는 선수(rmod) 값 갱신 후 리뷰 재렌더
async function handleModalSubmit(i) {
  const cid = i.data?.custom_id || '';
  const vals = {};
  (i.data?.components || []).forEach((row) => { const c = row.components?.[0]; if (c) vals[c.custom_id] = c.value; });
  if (cid.startsWith('rdmod:')) { // 시간 수정
    const pendingId = cid.split(':')[1];
    const pend = await getPending(pendingId);
    if (!pend) return updateMsg({ content: '⌛ 만료된 판독이에요.', embeds: [], components: [] });
    const d = parseFloat(vals.dur);
    pend.data.durationMin = Number.isFinite(d) ? d : pend.data.durationMin;
    await updatePending(pendingId, pend.data);
    return updateMsg(await reviewData(pend));
  }
  const [, pendingId, idxStr] = cid.split(':');
  const pend = await getPending(pendingId);
  if (!pend) return updateMsg({ content: '⌛ 만료된 판독이에요.', embeds: [], components: [] });
  const idx = Number(idxStr);
  const p = pend.data.participants[idx];
  if (!p) return updateMsg(await reviewData(pend));
  const [k, d, a] = (vals.kda || '').split('/').map((x) => parseInt(x, 10));
  pend.data.participants[idx] = {
    ...p, name: (vals.name || p.name).trim(), champion: (vals.champ || '').trim() || null,
    k: Number.isFinite(k) ? k : p.k, d: Number.isFinite(d) ? d : p.d, a: Number.isFinite(a) ? a : p.a,
    damage: parseInt(vals.dmg, 10) || 0, cs: parseInt(vals.cs, 10) || 0,
  };
  await updatePending(pendingId, pend.data);
  return updateMsg(await reviewData(pend));
}

async function cmdMatchShot(i, gid) {
  const photoId = opt(i, '스샷');
  if (!photoId) return reply('스코어보드 스샷을 첨부하세요: `/기록 스샷:<이미지>`');
  waitUntil(processMatchShot(i, photoId, gid)); // OCR 느림 → 백그라운드
  return NextResponse.json({ type: 5, data: { content: '📸 스코어보드 판독 중… (10초쯤 걸려요)' } });
}

// 서버 ↔ 방 연결 요청 (승인 방식). 요청만 생성 → 방장/관리자가 사이트에서 승인해야 활성화(테러 방지).
async function cmdLinkGuild(i, gid) {
  if (!i.guild_id) return reply('서버(길드) 안에서만 쓸 수 있어요.');
  const perms = BigInt(i.member?.permissions || '0');
  const canManage = (perms & 0x20n) !== 0n || (perms & 0x8n) !== 0n; // Manage Guild | Administrator
  if (!canManage) return reply('⚠️ 서버 관리 권한이 있는 사람만 방 연결을 요청할 수 있어요.');
  const code = (opt(i, '코드') || '').trim();
  if (!code) return reply('방 코드를 입력하세요. 예: `/방연결 코드:빙수`');
  const group = await getGroupByCode(code);
  if (!group) return reply(`"${code}" 코드의 방을 못 찾았어요. 사이트에서 방 코드를 확인하세요.`);
  const existing = await getGuildLink(i.guild_id);
  if (existing?.status === 'approved' && existing.group_id === group.id) return reply(`이미 **${group.name || group.code}** 에 연결돼 있어요.`);
  const requester = i.member?.user?.global_name || i.member?.user?.username || callerId(i);
  await requestGuildLink(i.guild_id, group.id, requester, null);
  return reply(`📨 **${group.name || group.code}** (#${group.code}) 연결 **요청**을 보냈어요.\n방장/관리자가 **사이트 → 점수표(설정) 페이지**에서 승인하면 이 서버에서 커맨드를 쓸 수 있어요. (승인 전까지는 대기)`);
}

const HANDLERS = { 리더보드: cmdLeaderboard, 전적: cmdRecord, 내전적: cmdMyRecord, 연동: cmdLink, 가입: cmdRegister, 프로필: cmdProfile, 칭호: cmdAwards, 방: cmdRoom, 밸런스: cmdBalance, 모집: cmdRecruit, 기록: cmdMatchShot, 방연결: cmdLinkGuild };

export async function POST(request) {
  const body = await request.text();
  if (!verifySignature(request.headers.get('x-signature-ed25519'), request.headers.get('x-signature-timestamp'), body)) {
    return new NextResponse('invalid request signature', { status: 401 });
  }
  const i = JSON.parse(body);
  if (i.type === 1) return NextResponse.json({ type: 1 }); // PING → PONG
  if (i.type === 2) { // 슬래시 커맨드
    const h = HANDLERS[i.data?.name];
    if (!h) return reply('알 수 없는 명령어예요.');
    const gid = await resolveGid(i); // 이 서버가 승인 연결한 방 (아니면 null)
    if (!gid && i.data?.name !== '방연결') {
      const link = i.guild_id ? await getGuildLink(i.guild_id) : null;
      if (link?.status === 'pending') return reply('⏳ 방 연결 **승인 대기중**이에요. 방장이 사이트에서 승인하면 사용할 수 있어요.');
      return reply('⚠️ 이 서버에 연결된 방이 없어요. `/방연결 코드:<방코드>` 로 요청하세요.');
    }
    try { return await h(i, gid); } catch (e) { return reply('오류: ' + e.message); }
  }
  if (i.type === 3) { // 버튼·드롭다운 (모집 큐 / 스샷 판독)
    try { return await handleComponent(i); } catch (e) { return ephem('오류: ' + e.message); }
  }
  if (i.type === 5) { // 모달 제출 (스샷 판독 선수 수정)
    try { return await handleModalSubmit(i); } catch (e) { return ephem('오류: ' + e.message); }
  }
  return NextResponse.json({ type: 4, data: { content: '지원하지 않는 인터랙션' } });
}
