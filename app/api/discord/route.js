// Discord 인터랙션 엔드포인트 (슬래시 커맨드). Discord가 여기로 POST → 서명검증 후 응답.
// 상시봇(gateway) 아님 = 서버리스라 항상 켜져 있음(컴퓨터 꺼짐 무관).
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { getStats, getAwards, getMatchHistory, listPersons, updatePerson, createPerson, addAccount, uploadAvatarFromUrl, saveMatch, refreshStalePersonTiers,
  createQueue, getQueue, getOpenQueue, closeQueue, reopenQueue, setQueueSize, listSignups, getSignup, upsertSignup, removeSignup, setQueueMessage,
  createPending, getPending, updatePending, deletePending,
  getGuildRoom, getGuildLink, requestGuildLink, getGroupByCode,
  isBotAdmin, grantBotAdmin, revokeBotAdmin, listBotAdmins, createReport, listReports, setGuildReportChannel, getGuildReportChannel } from '../../../src/repo.js';
import { getTournamentByCode, linkGuildTournament, setGuildNoticeChannel } from '../../../src/repo-tournament.js';
import { balance, balance20, balance20Split, balance20SplitByLane, balance20EvenByLane } from '../../../src/engine.js';
import { LANES, allocateQueue, subLanesOf } from '../../../src/queue.js';
import { MAINTENANCE } from '../../../src/maintenance.js';
import { queueMessage, buildTeamsRanked, buildMetaMap, allocateSignups, syncDiscordMessage, LANE_KR } from '../../../src/discord-queue.js';
import { parseRoflBuffer } from '../../../src/rofl.js';
import { fetchTierEstimate } from '../../../src/opgg.js';
import { TIER_LABEL, POS_KR, TIER_ORDER } from '../../../src/table.js';

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
const eembed = (e) => NextResponse.json({ type: 4, data: { embeds: [e], flags: 64, allowed_mentions: { parse: [] } } }); // 나만 보이는 임베드
const updateMsg = (data) => NextResponse.json({ type: 7, data }); // 버튼 눌린 메시지 갱신
const callerId = (i) => i.member?.user?.id || i.user?.id;
const discordUser = (i) => i.member?.user || i.user;
// 명령 실행자의 디코 서버별명(없으면 global_name/username) — 가입·연동 시 즉시 nickname으로 저장 (지연 없이 표시)
const callerNick = (i) => i.member?.nick || i.member?.user?.global_name || i.member?.user?.username || null;
const opt = (i, name) => (i.data?.options || []).find((o) => o.name === name)?.value;

// 디코 프로필 사진 URL (커스텀 없으면 기본 아바타)
function discordAvatarUrl(u) {
  if (!u?.id) return null;
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`;
  let idx = 0;
  try { idx = u.discriminator && u.discriminator !== '0' ? Number(u.discriminator) % 5 : Number((BigInt(u.id) >> 22n) % 6n); } catch { idx = 0; }
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}
// 서버(guild) 이름·아이콘 해시 — 사이트 헤더 브랜딩용. 실패해도 연결은 진행(조용히 null).
async function fetchGuildBrand(guildId) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!guildId || !token) return null;
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, { headers: { Authorization: `Bot ${token}` } });
    if (!r.ok) return null;
    const g = await r.json();
    return { name: g?.name || null, icon: g?.icon || null };
  } catch { return null; }
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
  // 웹 리더보드와 동일: 전체 노출(0판만 제외). 라플라스 보정 점수순 — 소표본 필터 안 함.
  const top = players.filter((p) => p.games > 0).sort((a, b) => b.score - a.score).slice(0, 10);
  if (!top.length) return reply('아직 기록된 선수가 없어요.');
  const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
  const lines = top.map((p, i) => `${medal(i)} **${p.nickname || p.name}** — ${p.score}점 · ${wr(p.winrate)} (${p.wins}승${p.losses}패)`);
  return embed({ title: '🏆 내전 리더보드', description: lines.join('\n'), color: GOLD });
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
  if (!q) return ephem('선수 이름을 입력하세요.');
  const { players } = await getStats(gid);
  const hit = players.filter((p) => p.games > 0).find((p) => normNm(p.nickname || p.name) === q)
    || players.filter((p) => p.games > 0).find((p) => normNm(p.nickname || p.name).includes(q));
  if (!hit) return ephem(`"${opt(i, '선수')}" 선수를 못 찾았어요.`);
  return eembed(playerEmbed(hit));
}

async function cmdMyRecord(i, gid) {
  const persons = await listPersons(gid);
  const me = persons.find((p) => p.discord_id === callerId(i));
  if (!me) return ephem('아직 연동 안 됐어요. `/연동 선수:내닉` 으로 먼저 연결하세요.');
  const { players } = await getStats(gid);
  const p = players.find((x) => x.id === me.id);
  if (!p || !p.games) return ephem('연동은 됐는데 아직 기록이 없어요.');
  return eembed(playerEmbed(p));
}

async function cmdLink(i, gid) {
  const q = normNm(opt(i, '선수') || '');
  if (!q) return ephem('연동할 선수 이름을 입력하세요.');
  const me = callerId(i);
  const persons = await listPersons(gid);
  const mine = persons.find((p) => p.discord_id === me);
  if (mine) return ephem(`이미 **${mine.nickname || mine.display_name}** 에 연동돼 있어요. 연동은 **한 번만** 가능해요. (바꾸려면 관리자에게 문의)`);
  const target = persons.find((p) => normNm(p.display_name) === q || normNm(p.nickname || '') === q)
    || persons.find((p) => normNm(p.display_name).includes(q));
  if (!target) return ephem(`"${opt(i, '선수')}" 선수를 못 찾았어요. 사람관리에 등록된 이름으로.`);
  if (target.discord_id && target.discord_id !== me) return ephem(`"${target.display_name}" 는 이미 다른 계정에 연동돼 있어요. 관리자에게 문의하세요.`);
  await updatePerson(target.id, { discord_id: me, nickname: callerNick(i) });
  await setDiscordAvatar(target, i); // 기본 아바타 = 디코 프로필 사진
  return ephem(`✅ <@${me}> ↔ **${target.display_name}** 연동 완료! 아바타는 디코 프로필 사진으로 설정됐어요 (\`/프로필\`로 변경 가능). 이제 \`/내전적\`·\`/밸런스\`에서 자동 인식돼요.`);
}

// 티어 측정 (seed API와 동일 파이프라인): op.gg 단일 소스
async function measureTier(name, tag, region) {
  return fetchTierEstimate(name, tag, region);
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

    const key = normNm(displayName), gkey = normNm(gameName);
    const exist = persons.find((p) => normNm(p.display_name) === key
      || (p.accounts || []).some((a) => normNm(a.game_name) === gkey)); // 인게임 이름·등록계정(Riot ID)으로 매칭. 디코 별명 제외(타인 인게임닉과 충돌 방지)
    if (exist && exist.discord_id) return followup(i, `"${displayName}" 은(는) 이미 다른 계정에 연동돼 있어요. 관리자에게 문의.`);
    let personId;
    const nick = callerNick(i);
    if (exist) { // 미연동 동명 카드 → 연결 + 측정 티어로 갱신
      await updatePerson(exist.id, { discord_id: me, base_tier: tier, nickname: nick });
      personId = exist.id;
    } else {
      const secondary = sub && sub !== main ? [sub] : [];
      const p = await createPerson(gid, { display_name: displayName, base_tier: tier, primary_positions: [main], secondary_positions: secondary });
      await updatePerson(p.id, { discord_id: me, nickname: nick });
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
  if (!raw.includes('#')) return ephem('❌ 라이엇 ID를 #태그까지 정확히 입력하세요. 예: `홍길동#KR1` (해시태그 없으면 측정 불가)');
  if (!opt(i, '주라인')) return ephem('주라인을 선택하세요.');
  waitUntil(processRegister(i, gid)); // 측정 7초+ → 백그라운드
  return NextResponse.json({ type: 5, data: { content: `🔎 **${raw}** 티어 측정 중… (몇 초 걸려요)`, flags: 64 } }); // deferred·나만보기
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

// 셀프 프로필: 사진 업로드 또는 디스코드 프로필 사진. (색/이모지 기능 제거)
async function cmdProfile(i, gid) {
  const photoId = opt(i, '사진'); // 첨부 업로드 → 재호스팅(느림) → defer
  if (photoId) { waitUntil(processProfilePhoto(i, photoId, gid)); return NextResponse.json({ type: 5, data: { content: '📷 프로필 사진 저장 중…', flags: 64 } }); }
  const me = callerId(i);
  const persons = await listPersons(gid);
  const meP = persons.find((p) => p.discord_id === me);
  if (!meP) return ephem('먼저 `/가입`(신규) 또는 `/연동`(기존)으로 등록하세요.');
  if (opt(i, '디코사진') !== true) return ephem('`사진:` 으로 이미지를 올리거나, `디코사진:True` 로 디스코드 프로필 사진을 쓰세요.');
  const profile = { ...(meP.profile || {}), avatar: discordAvatarUrl(discordUser(i)) };
  delete profile.color; delete profile.emoji; // 남아있던 커스텀 제거
  try { await updatePerson(meP.id, { profile }); }
  catch { return ephem('프로필 저장 실패 — 관리자에게 `profile` 컬럼 추가를 요청하세요.'); }
  return ephem(`✅ **${meP.nickname || meP.display_name}** 아바타를 디스코드 프로필 사진으로 설정했어요.`);
}

async function cmdAwards(i, gid) {
  const a = await getAwards(gid);
  const L = [];
  const line = (ic, t, who, stat) => who && L.push(`${ic} **${t}** — ${who} ${stat ? `(${stat})` : ''}`);
  line('🏆', '공공의적', a.publicEnemy?.name, a.publicEnemy && `${wr(a.publicEnemy.winrate)} ${a.publicEnemy.wins}승${a.publicEnemy.losses}패`);
  line('👑', '칭호왕', a.titleKing?.name, a.titleKing && `${a.titleKing.count}개 보유`);
  line('💥', '캐리왕', a.carryKing?.name, a.carryKing && `평균딜 ${(a.carryKing.avgDamage / 1000).toFixed(1)}k`);
  line('🎮', '고인물', a.gameAddict?.name, a.gameAddict && `${a.gameAddict.games}판`);
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
    components: candidates.length > 1 ? [{ type: 1, components: [
      { type: 2, style: 2, label: '◀ 이전 조합', custom_id: `br:${pendingId}:${idx}:p` },
      { type: 2, style: 1, label: `${idx + 1} / ${candidates.length}`, custom_id: `br:${pendingId}:${idx}:x`, disabled: true },
      { type: 2, style: 2, label: '다음 조합 ▶', custom_id: `br:${pendingId}:${idx}:n` },
    ] }] : [],
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

// /밸런스 조합 넘기기: 저장된 명단으로 재계산 → 이전/다음 후보 순환
async function handleBalanceReroll(pendingId, curIdxStr, dir) {
  const pend = await getPending(pendingId);
  if (!pend || pend.data?.type !== 'balance') return ephem('⌛ 만료된 밸런스예요. 다시 `/밸런스` 해주세요.');
  const r = balance(pend.data.players, {});
  if (!r.feasible || !r.candidates?.length) return ephem('팀을 다시 짤 수 없어요.');
  const step = dir === 'p' ? -1 : 1; // ◀ 이전 / ▶ 다음
  const nextIdx = (Number(curIdxStr || 0) + step + r.candidates.length) % r.candidates.length;
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
  // 방 하나당 열린 모집은 하나만 — 기존 모집 마감 전엔 새 /모집 금지 (사이트 '오늘 내전' 갈아껴짐 방지)
  const existing = await getOpenQueue(gid);
  if (existing) return ephem('이미 열린 모집이 있어요. 그 모집을 먼저 **🔒 마감**한 뒤에 다시 `/모집` 해주세요.\n(안 그러면 사이트 "오늘 내전"이 새 모집으로 갈아껴져요.)');
  const size = opt(i, '인원') === 20 ? 20 : 10;
  const q = await createQueue(gid, size, callerId(i), i.channel_id);
  waitUntil(captureMessageId(i, q.id));
  return NextResponse.json({ type: 4, data: queueMessage(q, [], false) });
}

// 20인 마감 → 4팀 편성. mode='split'(고저분리) | 'even'(4팀 균등). idx=조합 인덱스(리롤).
// 반환 정규화: { mode, games:[{lanes,sumA,sumB},{...}], spread?, counts:[..], cur:[..] }
//  even: counts=[전체 arrangement 수], cur=[선택] · split: counts=[게임1 후보수, 게임2 후보수], cur=[i0,i1]
const wrap = (i, n) => (((i % n) + n) % n);
const gameCell = (c) => ({ lanes: c.lanes, sumA: c.sumA, sumB: c.sumB });
function autoTeams20(queue, signups, persons, mode = 'split', idx = [0, 0]) {
  const alloc = allocateSignups(queue, signups);
  const placedIds = LANES.flatMap((l) => alloc.lanes[l]);
  if (placedIds.length !== 20) return null;
  const byD = new Map(persons.filter((p) => p.discord_id).map((p) => [p.discord_id, p]));
  const byId = new Map(persons.map((p) => [p.id, p]));
  const info = new Map(signups.map((s) => [s.discord_id, s])); // 이번 큐 신청 정보(라인)
  const laneOf = {}; LANES.forEach((l) => alloc.lanes[l].forEach((did) => { laneOf[did] = l; })); // 배정 라인(고저분리용)
  const players = [];
  for (const did of placedIds) {
    const person = did.startsWith('site:') ? byId.get(did.slice(5)) : byD.get(did);
    if (!person) return null;
    // 🔑 팀편성 포지션 = '이번 큐에서 신청한 라인'(10인과 동일). 멤버관리 등록 포지션이 아님.
    //    고정 라인으로 신청하면 그 라인 존중(올라운더로 안 풀림), ALL 신청만 전 라인 자유.
    const s = info.get(did) || {};
    const all = s.main === 'all';
    let positions = all ? [...LANES] : [...new Set([s.main, ...subLanesOf(s)])].filter((l) => LANES.includes(l));
    if (!positions.length) positions = [...LANES];
    players.push({
      name: person.nickname || person.display_name,
      tier: person.base_tier, secondaryTier: person.secondary_tier || null,
      positions,
      // 부라인 티어(secondary) 판단 = 멤버관리의 주포지션 기준(큐 메인 아님). 주포지션 밖 라인에 배치되면 secondary_tier 적용.
      primary: all ? [] : (person.primary_positions || []),
      adj: all ? -1 : 0,
      lane: laneOf[did], // 배정된 라인 — 고저분리(라인별) 시 이 라인 고정
    });
  }
  try {
    if (mode === 'even') {
      const arr = balance20EvenByLane(players).arrangements; // 라인별 4팀 균등 (신청 라인 유지)
      if (!arr.length) return null;
      const ai = wrap(idx[0] || 0, arr.length);
      const a = arr[ai];
      return { mode: 'even', spread: a.spread, counts: [arr.length], cur: [ai], games: a.views.map(gameCell) };
    }
    const r = balance20SplitByLane(players); // 라인별 고저분리 (신청 라인 유지)
    const g0 = r.games[0].candidates, g1 = r.games[1].candidates;
    const i0 = wrap(idx[0] || 0, g0.length), i1 = wrap(idx[1] || 0, g1.length);
    return { mode: 'split', counts: [g0.length, g1.length], cur: [i0, i1], games: [gameCell(g0[i0]), gameCell(g1[i1])] };
  } catch { return null; }
}

// 부분 인원(10~19명) → 유지할 10명 선택. policy=late(늦은신청 제외)|tier(약티어 제외)|rand. null=2인/라인 불가.
function pickTen(signups, persons, policy) {
  const byD = new Map(persons.filter((p) => p.discord_id).map((p) => [p.discord_id, p]));
  const byId = new Map(persons.map((p) => [p.id, p]));
  const tierRankOf = (id) => { const p = String(id).startsWith('site:') ? byId.get(id.slice(5)) : byD.get(id); const idx = TIER_ORDER.indexOf(p?.base_tier); return idx < 0 ? 999 : idx; }; // 작을수록 강함
  const arr = signups.map((s, idx) => ({ id: s.discord_id, main: s.main, sub: s.sub || null, idx }));
  if (policy === 'tier') arr.sort((a, b) => tierRankOf(a.id) - tierRankOf(b.id) || a.idx - b.idx); // 강한 티어 우선 → 약한 사람이 대기(탈락)
  else if (policy === 'rand') { for (let i = arr.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }
  // late: 신청순(idx) 그대로 → 늦은 사람이 대기(탈락)
  const input = arr.map((x, i) => ({ id: x.id, main: x.main, sub: x.sub, order: i }));
  const alloc = allocateQueue(input, 10);
  const keep = LANES.flatMap((l) => alloc.lanes[l]);
  if (keep.length !== 10) return null;
  const keepSet = new Set(keep);
  return { keepIds: keep, removeIds: signups.map((s) => s.discord_id).filter((id) => !keepSet.has(id)) };
}

// 20인이 부분(10~19)으로 마감 → 초과 인원 빼는 방법 4지선다
function trimOptionsMessage(queue, n) {
  return {
    embeds: [{ title: `🎮 롤 내전 · 20인 · 마감됨 (${n}명)`, color: GOLD,
      description: `신청 **${n}명** — 20명이 안 차서 **10인 1게임**으로 편성할게요.\n초과 **${n - 10}명**을 어떻게 뺄까요? _(모집자만)_` }],
    components: [
      { type: 1, components: [
        { type: 2, style: 1, label: '⏱ 늦게 신청한 사람', custom_id: `t20:${queue.id}:late` },
        { type: 2, style: 1, label: '📉 티어 낮은 사람', custom_id: `t20:${queue.id}:tier` },
        { type: 2, style: 1, label: '🎲 랜덤', custom_id: `t20:${queue.id}:rand` },
      ] },
      { type: 1, components: [{ type: 2, style: 2, label: '🖐 관리자 지정으로 빼기', custom_id: `t20:${queue.id}:pick` }] },
    ],
  };
}

// 마감 처리 (백그라운드) — closeQueue + 팀짜기(무거움) → followupData로 원본 메시지 편집.
// defer(type 6) 후 호출됨. 3초 시한에 안 묶여 전원 올라운더 같은 큰 탐색도 안전.
async function closeAndPost(i, queue) {
  try {
    const qid = queue.id;
    await closeQueue(qid);
    const signups = await listSignups(qid);
    const persons = await listPersons(queue.gid);
    const metaMap = buildMetaMap(persons);
    if (queue.size === 20) {
      const alloc = allocateSignups({ ...queue, status: 'closed' }, signups);
      const placed = LANES.flatMap((l) => alloc.lanes[l]);
      if (placed.length === 20) { // 20명 배정됨(21명+ 이면 초과분은 대기) → 고저분리 4팀
        const teams20 = autoTeams20({ ...queue, status: 'closed' }, signups, persons);
        if (teams20) {
          await pingTeams(i, signups, null, metaMap); // 전원 태그(4팀은 메시지에 표시)
          return followupData(i, queueMessage({ ...queue, status: 'closed' }, signups, true, null, 0, teams20, metaMap));
        }
        // teams20 실패(포지션 미지정 등) → 아래 폴백
      }
      if (signups.length >= 10) { // 부분 인원(20 미만) → 10인 1게임
        if (signups.length === 10) {
          const ranked = buildTeamsRanked({ ...queue, status: 'closed' }, signups, metaMap);
          return followupData(i, queueMessage({ ...queue, status: 'closed' }, signups, true, ranked[0], 0, null, metaMap, ranked.length));
        }
        return followupData(i, trimOptionsMessage(queue, signups.length)); // 11~19 → 초과 빼기 4지선다
      }
      return followupData(i, { embeds: [{ title: '🎮 롤 내전 · 20인 · 마감됨', color: GOLD, description: `❌ 신청 **${signups.length}명** — 10명 이상이어야 팀을 짤 수 있어요.` }], components: [] });
    }
    // 10인: 마감 = 팀 '미리보기'만 (자동 핑 없음). 조합 넘겨보고 ✅ 확정 눌러야 전원 호출됨.
    const ranked = buildTeamsRanked({ ...queue, status: 'closed' }, signups, metaMap);
    return followupData(i, queueMessage({ ...queue, status: 'closed' }, signups, true, ranked[0], 0, null, metaMap, ranked.length));
  } catch (e) {
    try { await followupData(i, { content: '⚠️ 마감 처리 중 오류가 났어요. 다시 시도해주세요.', embeds: [], components: [] }); } catch { /* 무시 */ }
  }
}

// 나가기로 자리 나서 대기자가 배정되면 → 그 사람 태그해서 "자리 났어요" 알림. site: 키는 태그 못하니 스킵.
async function pingPromoted(i, queue, before, after) {
  try {
    const b = allocateSignups(queue, before);
    const a = allocateSignups(queue, after);
    const wasWaiting = new Set(b.waitlist);
    const placedLane = {};
    LANES.forEach((l) => a.lanes[l].forEach((id) => { placedLane[id] = l; }));
    const promoted = Object.keys(placedLane).filter((id) => wasWaiting.has(id) && !String(id).startsWith('site:'));
    if (!promoted.length) return;
    const content = promoted.map((id) => `🎉 <@${id}> 자리가 나서 **${LANE_KR[placedLane[id]]}**로 들어왔어요! (대기 → 참가)`).join('\n');
    await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { users: promoted.slice(0, 50) } }),
    });
  } catch { /* 승격 핑 실패는 무시 (배정·메시지는 정상) */ }
}

// 마감 시 신청자 전원을 태그해 호출 (새 followup 메시지 = 실제 알림 발생). site: 키는 태그 못하니 이름만.
async function pingTeams(i, signups, teams, metaMap) {
  const ids = signups.map((s) => s.discord_id).filter((id) => id && !id.startsWith('site:'));
  const cell = (p) => {
    const who = (p.discordId && !p.discordId.startsWith('site:')) ? `<@${p.discordId}>` : `**${p.name}**`;
    return `　${LANE_KR[p.lane]} ${who}${p.tier ? ` \`${p.tier}\`` : ''}`; // p.tier=배정라인 반영(부라인티어)
  };
  let content;
  if (teams) {
    content = `🎮 **내전 시작! 팀 확정 — 모두 모여요!**\n🟦 **블루**\n${teams.A.map(cell).join('\n')}\n🟥 **레드**\n${teams.B.map(cell).join('\n')}`;
  } else {
    if (!ids.length) return;
    content = `🎮 **내전 마감! 모두 모여요**\n${ids.map((id) => `<@${id}>`).join(' ')}`;
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
  if (action === 'tr') return handleTeamReroll(qid, lane, parts[3]); // 마감 자동팀 조합 넘기기 (lane=현재idx, parts[3]=방향 p/n)
  if (action === 'tc') return handleTeamConfirm(i, qid, lane); // 이 조합으로 확정 → 전원 호출 (lane=선택 idx)
  if (action === 't20') return handleTrim20(i, qid, lane); // 20인 부분마감 초과인원 빼기 (lane=policy)
  if (action === 't20pick') return handleTrim20Pick(i, qid); // 관리자 지정 빼기 (셀렉트)
  if (action === 't20m') return handleTeams20Mode(i, qid, lane); // 풀20 편성 모드 토글 (lane=even|split)
  if (action === 't20r') return handleTeams20Reroll(i, parts); // 풀20 조합 리롤
  if (action === 'br') return handleBalanceReroll(qid, lane, parts[3]); // /밸런스 조합 넘기기
  if (action === 'rec' || action === 'rex') return handleRecordConfirm(i, action, qid); // 스샷 판독 확인/취소
  if (action === 'rswap') return handleRecordSwap(qid); // 승패 뒤집기
  if (action === 'rdur') return handleRecordDurOpen(i, qid); // 시간 수정 모달
  if (action === 'redit') return handleRecordEditOpen(i, qid); // 선수 값수정 모달
  if (action === 'rmap') return handleRecordMapOpen(i, qid); // 🆕 → 기존선수 지정 열기
  if (action === 'rmapto') return handleRecordMapTo(i, qid, lane); // 지정 완료 (lane=idx)
  if (action === 'rback') { const pd = await getPending(qid); return pd ? updateMsg(await reviewData(pd)) : updateMsg({ content: '⌛ 만료된 판독이에요.', embeds: [], components: [] }); }
  const queue = await getQueue(qid);
  if (!queue) return ephem('모집을 찾을 수 없어요 (오래된 메시지일 수 있어요).');
  const me = callerId(i);
  if (queue.status !== 'open') {
    // 이미 마감됐지만 팀이 안 떴을 수 있음(옛 타임아웃으로 closeQueue만 되고 편성 실패) → 마감 다시 누르면 팀 재생성.
    if (action === 'qc') {
      if (queue.host_id && me !== queue.host_id) return ephem('모집 만든 사람만 마감할 수 있어요.');
      waitUntil(closeAndPost(i, queue));
      return NextResponse.json({ type: 6 });
    }
    if (action === 'qo') { // 🔓 마감 번복 → 다시 열기 (신청자·자리 유지)
      if (queue.host_id && me !== queue.host_id) return ephem('모집 만든 사람만 다시 열 수 있어요.');
      try { await reopenQueue(qid); } catch (e) { return ephem(e.message); }
      const signups = await listSignups(qid);
      const metaMap = buildMetaMap(await listPersons(queue.gid));
      return updateMsg(queueMessage({ ...queue, status: 'open' }, signups, false, null, 0, null, metaMap));
    }
    return ephem('이미 마감된 모집이에요.');
  }

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
    waitUntil(refreshStalePersonTiers(meP.id)); // 신청 시 티어 자동 갱신(7일+ 오래된 계정만, 백그라운드)
  } else if (action === 'qs') { // 부/대기 라인 드롭다운 (여러 개 가능)
    const ex = await getSignup(qid, me);
    if (!ex) return ephem('먼저 메인 라인을 선택하세요.');
    const vals = (i.data?.values || []).filter((v) => v !== ex.main); // 메인과 겹치는 라인 제외
    await upsertSignup(qid, me, { sub: vals.length ? vals.join(',') : null });
  } else if (action === 'ql') { // 나가기 → 자리 나면 대기자 자동 승격 + 알림
    const before = await listSignups(qid);
    await removeSignup(qid, me);
    const after = before.filter((s) => s.discord_id !== me);
    waitUntil(pingPromoted(i, queue, before, after));
  } else if (action === 'qk') { // 🚫 방장 킥 → 신청자 선택 셀렉트 (나만 보이게)
    if (queue.host_id && me !== queue.host_id) return ephem('모집 만든 사람만 킥할 수 있어요.');
    const signups = await listSignups(qid);
    if (!signups.length) return ephem('신청자가 없어요.');
    const metaMap = buildMetaMap(await listPersons(queue.gid));
    const opts = signups.slice(0, 25).map((s) => { const m = metaMap.get(s.discord_id) || {}; return { label: (m.game || s.name || '?').slice(0, 90), value: s.discord_id, description: `${LANE_KR[s.main] || s.main || ''} ${m.baseTier || ''}`.trim().slice(0, 90) }; });
    return NextResponse.json({ type: 4, data: { flags: 64, content: '🚫 뺄 신청자를 고르세요 (여러 명 가능):', components: [{ type: 1, components: [{ type: 3, custom_id: `qks:${qid}`, placeholder: '킥할 신청자 선택', min_values: 1, max_values: Math.min(signups.length, 25), options: opts }] }] } });
  } else if (action === 'qks') { // 킥 실행 (셀렉트 결과)
    if (queue.host_id && me !== queue.host_id) return ephem('모집 만든 사람만 킥할 수 있어요.');
    const kick = i.data?.values || [];
    const before = await listSignups(qid);
    for (const id of kick) await removeSignup(qid, id);
    const after = await listSignups(qid);
    waitUntil(pingPromoted(i, queue, before, after)); // 대기자 승격 알림
    waitUntil(syncDiscordMessage(queue, after, buildMetaMap(await listPersons(queue.gid)))); // 원본 모집 메시지 갱신
    return updateMsg({ content: `✅ ${kick.length}명 킥 완료 — 모집 메시지가 갱신됐어요.`, embeds: [], components: [] });
  } else if (action === 'qc') { // 마감 (만든 사람만) → 자동팀 + 신청자 태그 호출
    if (queue.host_id && me !== queue.host_id) return ephem('모집 만든 사람만 마감할 수 있어요.');
    // ⚠️ 팀짜기(balance)는 전원 올라운더(ALL)면 탐색공간이 폭발해 3초를 넘길 수 있음 → Discord 상호작용 시한 초과로 마감이 조용히 실패.
    //    defer(type 6)로 먼저 ACK하고, 무거운 팀계산은 백그라운드에서 돌려 원본 메시지를 편집한다.
    waitUntil(closeAndPost(i, queue));
    return NextResponse.json({ type: 6 }); // DEFERRED_UPDATE_MESSAGE
  } else if (action === 'qsz') { // 👥 10↔20 인원 전환 (만든 사람만) — 신청자·대기 전원 그대로 유지
    if (queue.host_id && me !== queue.host_id) return ephem('모집 만든 사람만 인원을 바꿀 수 있어요.');
    const newSize = lane === '20' ? 20 : 10;
    await setQueueSize(qid, newSize);
    queue.size = newSize; // 아래 재렌더에 반영 (신청자는 그대로, 배정만 N=2↔4로 재계산)
  }
  // 알 수 없는/오래된 버튼(구버전 메시지 등)은 에러 대신 현재 모집 상태로 새로고침해서 복구.
  const freshSignups = await listSignups(qid);
  const metaMap = buildMetaMap(await listPersons(queue.gid));
  return updateMsg(queueMessage(queue, freshSignups, false, null, 0, null, metaMap));
}

// ── 리플(.rofl) 자동 전적기록 ── 다운로드 → 파싱 → Riot ID 자동매핑 → 확인 → saveMatch(objectives·상세 포함)
const roflAccKey = (gn, tag) => `${normNm(gn)}#${(tag || '').toLowerCase()}`;
async function processMatchReplay(i, fileId, gid) {
  try {
    const att = i.data?.resolved?.attachments?.[fileId];
    if (!att) return followup(i, '❌ .rofl 리플레이 파일을 올려주세요.');
    if (!(att.filename || '').toLowerCase().endsWith('.rofl')) return followup(i, '❌ .rofl 파일만 돼요. (롤 리플레이 · 클라이언트 전적에서 다운로드)');
    if (att.size > 60 * 1024 * 1024) return followup(i, '❌ 리플이 너무 커요 (60MB↑). 롱겜은 사이트에서 올려주세요.');
    const res = await fetch(att.url);
    if (!res.ok) return followup(i, '리플 다운로드 실패, 다시 시도하세요.');
    let parsed;
    try { parsed = parseRoflBuffer(new Uint8Array(await res.arrayBuffer())); }
    catch (e) { return followup(i, '리플 분석 실패: ' + e.message); }

    // Riot ID 자동매핑 (계정 game_name#tag_line → 사람). 태그 우선, 없으면 이름.
    const persons = await listPersons(gid);
    const byFull = new Map(); const byName = new Map();
    persons.forEach((p) => (p.accounts || []).forEach((a) => {
      const nm = normNm(a.game_name); if (!nm) return;
      byName.set(nm, p);
      if (a.tag_line) byFull.set(roflAccKey(a.game_name, a.tag_line), p);
    }));
    const findPerson = (gn, tag) => (tag && byFull.get(roflAccKey(gn, tag))) || byName.get(normNm(gn)) || null;

    const ord = { top: 0, jungle: 1, mid: 2, adc: 3, sup: 4 };
    const sorted = [...parsed.players].sort((a, b) => (a.team === b.team ? (ord[a.position] ?? 9) - (ord[b.position] ?? 9) : (a.team === 'A' ? -1 : 1)));
    const participants = sorted.map((pl) => {
      const person = findPerson(pl.gameName, pl.tag);
      return {
        name: person ? (person.nickname || person.display_name) : (pl.riotId || pl.gameName || '?'),
        person_id: person?.id || undefined,
        team: pl.team, champion: pl.champion || null, position: pl.position || null,
        k: pl.k, d: pl.d, a: pl.a, damage: pl.damage, cs: pl.cs, gold: pl.gold, detail: pl.detail,
      };
    });
    const data = { winner: parsed.winner, participants, durationMin: parsed.durationMin, durationSec: parsed.durationSec, objectives: parsed.objectives, source: 'replay' };
    const pendingId = await createPending(gid, data);
    return followupData(i, await reviewData({ id: pendingId, gid, data }));
  } catch (e) { return followup(i, '기록 처리 오류: ' + e.message); }
}

const LANE_TAG = ['TOP', 'JG', 'MID', 'BOT', 'SUP']; // 스샷 슬롯 순서

// 마감 자동팀 리롤: 같은 로스터로 다음 균형 조합(랭킹 순환)
async function handleTeamReroll(qid, curIdxStr, dir) {
  const queue = await getQueue(qid);
  if (!queue) return ephem('⌛ 만료된 모집이에요.');
  const signups = await listSignups(qid);
  const persons = await listPersons(queue.gid);
  const metaMap = buildMetaMap(persons);
  const ranked = buildTeamsRanked({ ...queue, status: 'closed' }, signups, metaMap);
  if (!ranked.length) return ephem('팀을 다시 짤 수 없어요 (10인 아님).');
  const step = dir === 'p' ? -1 : 1; // ◀ 이전 / ▶ 다음
  const nextIdx = (Number(curIdxStr || 0) + step + ranked.length) % ranked.length;
  return updateMsg(queueMessage({ ...queue, status: 'closed' }, signups, true, ranked[nextIdx], nextIdx, null, metaMap, ranked.length));
}

// 이 조합으로 확정 → 선택한 조합으로 전원 호출(핑) + 메시지를 확정본으로 잠금. 방장만.
async function handleTeamConfirm(i, qid, idxStr) {
  const queue = await getQueue(qid);
  if (!queue) return ephem('⌛ 만료된 모집이에요.');
  if (queue.host_id && callerId(i) !== queue.host_id) return ephem('모집 만든 사람만 확정할 수 있어요.');
  const signups = await listSignups(qid);
  const persons = await listPersons(queue.gid);
  const metaMap = buildMetaMap(persons);
  const ranked = buildTeamsRanked({ ...queue, status: 'closed' }, signups, metaMap);
  if (!ranked.length) return ephem('팀을 확정할 수 없어요 (10인 아님).');
  const idx = Math.min(Math.max(Number(idxStr || 0), 0), ranked.length - 1);
  const teams = ranked[idx];
  waitUntil(pingTeams(i, signups, teams, metaMap)); // 선택한 조합으로 전원 태그 호출
  return updateMsg(queueMessage({ ...queue, status: 'closed' }, signups, true, teams, idx, null, metaMap, ranked.length, true));
}

// 20인 부분마감 → 초과 인원 빼고 10인 편성. policy=late|tier|rand|pick (방장만)
async function handleTrim20(i, qid, policy) {
  const queue = await getQueue(qid);
  if (!queue) return ephem('⌛ 만료된 모집이에요.');
  if (queue.host_id && callerId(i) !== queue.host_id) return ephem('모집 만든 사람만 할 수 있어요.');
  const signups = await listSignups(qid);
  const persons = await listPersons(queue.gid);
  const metaMap = buildMetaMap(persons);
  const renderTeams = (sg) => { const ranked = buildTeamsRanked({ ...queue, status: 'closed' }, sg, metaMap); return updateMsg(queueMessage({ ...queue, status: 'closed' }, sg, true, ranked[0], 0, null, metaMap, ranked.length)); };
  if (signups.length <= 10) return renderTeams(signups); // 이미 10명 이하 → 바로 편성
  if (policy === 'pick') { // 관리자 지정: 뺄 사람 N-10명 선택
    const need = signups.length - 10;
    const opts = signups.slice(0, 25).map((s) => { const m = metaMap.get(s.discord_id) || {}; return { label: (m.game || s.name || '?').slice(0, 90), value: s.discord_id, description: `${LANE_KR[s.main] || s.main || ''} ${m.baseTier || ''}`.trim().slice(0, 90) }; });
    return updateMsg({ embeds: [{ title: '🖐 뺄 사람 선택', color: GOLD, description: `10명이 되도록 **${need}명**을 골라 빼세요.` }],
      components: [{ type: 1, components: [{ type: 3, custom_id: `t20pick:${qid}`, placeholder: `뺄 사람 ${need}명 선택`, min_values: need, max_values: need, options: opts }] }] });
  }
  const pick = pickTen(signups, persons, policy);
  if (!pick) return ephem('특정 라인 인원이 부족해 5v5(2인/라인)를 만들 수 없어요. 🖐 관리자 지정으로 조정해보세요.');
  for (const id of pick.removeIds) await removeSignup(qid, id);
  return renderTeams(await listSignups(qid));
}

// 풀20 편성 모드 토글: 고저분리 ↔ 4팀 균등 (뷰 전환, 핑 없음)
async function handleTeams20Mode(i, qid, mode) {
  const queue = await getQueue(qid);
  if (!queue) return ephem('⌛ 만료된 모집이에요.');
  const signups = await listSignups(qid);
  const persons = await listPersons(queue.gid);
  const metaMap = buildMetaMap(persons);
  const teams20 = autoTeams20({ ...queue, status: 'closed' }, signups, persons, mode === 'even' ? 'even' : 'split');
  if (!teams20) return ephem('팀 편성을 못 했어요 — 신청자 20명·라인 배정이 안 맞거나 선수 정보가 바뀌었을 수 있어요. 🔓 다시 열기 후 확인하거나 새로 `/모집` 해주세요.');
  return updateMsg(queueMessage({ ...queue, status: 'closed' }, signups, true, null, 0, teams20, metaMap));
}

// 풀20 조합 리롤. even: t20r:qid:even:cur:dir · split: t20r:qid:split:game:cur0:cur1:dir
async function handleTeams20Reroll(i, parts) {
  const qid = parts[1], mode = parts[2];
  const queue = await getQueue(qid);
  if (!queue) return ephem('⌛ 만료된 모집이에요.');
  const signups = await listSignups(qid);
  const persons = await listPersons(queue.gid);
  const metaMap = buildMetaMap(persons);
  let idx;
  if (mode === 'even') { const step = parts[4] === 'p' ? -1 : 1; idx = [(Number(parts[3]) || 0) + step, 0]; }
  else { const g = Number(parts[3]) || 0; const step = parts[6] === 'p' ? -1 : 1; idx = [Number(parts[4]) || 0, Number(parts[5]) || 0]; idx[g] += step; }
  const teams20 = autoTeams20({ ...queue, status: 'closed' }, signups, persons, mode, idx);
  if (!teams20) return ephem('팀 편성을 못 했어요 — 선수 정보가 바뀌었거나 라인 배정이 안 맞아요. 🔓 다시 열기 후 확인하거나 새로 `/모집` 해주세요.');
  return updateMsg(queueMessage({ ...queue, status: 'closed' }, signups, true, null, 0, teams20, metaMap));
}

// 관리자 지정 빼기 (셀렉트 결과) → 10명 되면 편성
async function handleTrim20Pick(i, qid) {
  const queue = await getQueue(qid);
  if (!queue) return ephem('⌛ 만료된 모집이에요.');
  if (queue.host_id && callerId(i) !== queue.host_id) return ephem('모집 만든 사람만 할 수 있어요.');
  for (const id of (i.data?.values || [])) await removeSignup(qid, id);
  const fresh = await listSignups(qid);
  const metaMap = buildMetaMap(await listPersons(queue.gid));
  if (fresh.length > 10) return updateMsg(trimOptionsMessage(queue, fresh.length)); // 아직 초과 → 다시
  const ranked = buildTeamsRanked({ ...queue, status: 'closed' }, fresh, metaMap);
  if (!ranked.length) return updateMsg({ embeds: [{ title: '⚠️ 편성 불가', color: GOLD, description: '남은 인원으로 5v5(2인/라인)가 안 나와요. 라인 분포를 확인하세요.' }], components: [] });
  return updateMsg(queueMessage({ ...queue, status: 'closed' }, fresh, true, ranked[0], 0, null, metaMap, ranked.length));
}

// 판독 리뷰 메시지(embed + 셀렉트/버튼) — 초기 표시·수정 후 재렌더 공용.
// mapSlot 지정 시: 그 자리를 "기존 선수로 지정"하는 person 셀렉트를 보여줌.
async function reviewData(pend, mapSlot) {
  const persons = await listPersons(pend.gid);
  // 인게임 이름 식별 = display_name + 등록계정(game_name). 디코 별명(nickname)은 타인 인게임닉과 충돌하므로 제외.
  const known = new Set(persons.flatMap((p) => [p.display_name, ...(p.accounts || []).map((a) => a.game_name)].filter(Boolean).map(normNm)));
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

// 리더보드 TOP5 사람ID (전체 · 점수순, 웹·리더보드와 동일) — 순위변동 비교용
async function topIds(gid) {
  try { return (await getStats(gid)).players.filter((p) => p.games > 0).sort((a, b) => b.score - a.score).slice(0, 5).map((p) => p.id); } catch { return []; }
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

// 서버 관리자(Manage Guild | Administrator) 감지 — Discord 권한 비트
const isServerAdmin = (i) => { const p = BigInt(i.member?.permissions || '0'); return (p & 0x20n) !== 0n || (p & 0x8n) !== 0n; };
// 모더레이터: 관리자 | 서버관리 | 추방 | 차단 | 메시지관리 — 신고 운영용(모드팀도 가능)
const isModerator = (i) => { const p = BigInt(i.member?.permissions || '0'); return (p & 0x8n) !== 0n || (p & 0x20n) !== 0n || (p & 0x2n) !== 0n || (p & 0x4n) !== 0n || (p & 0x2000n) !== 0n; };

async function cmdMatchShot(i, gid) {
  // 서버 관리자 또는 봇 관리자(/관리자 승격)만 기록 가능
  if (!isServerAdmin(i) && !(await isBotAdmin(gid, callerId(i)))) {
    return ephem('⚠️ 기록 권한이 없어요. 서버 관리자에게 `/관리자 동작:승격` 으로 권한을 요청하세요.');
  }
  const fileId = opt(i, '리플');
  if (!fileId) return ephem('.rofl 리플레이 파일을 첨부하세요: `/기록 리플:<파일>`');
  waitUntil(processMatchReplay(i, fileId, gid)); // 다운로드+파싱 → 백그라운드
  return NextResponse.json({ type: 5, data: { content: '🎬 리플 분석 중… (잠시만요)', flags: 64 } }); // 판독/수정은 나만보기
}

// 서버 ↔ 방 연결 요청 (승인 방식). 요청만 생성 → 방장/관리자가 사이트에서 승인해야 활성화(테러 방지).
async function cmdLinkGuild(i, gid) {
  if (!i.guild_id) return ephem('서버(길드) 안에서만 쓸 수 있어요.');
  const perms = BigInt(i.member?.permissions || '0');
  const canManage = (perms & 0x20n) !== 0n || (perms & 0x8n) !== 0n; // Manage Guild | Administrator
  if (!canManage) return ephem('⚠️ 서버 관리 권한이 있는 사람만 연결할 수 있어요.');
  // 대회: 옵션 → 이 서버를 대회에 연결 (서버는 /방연결로 이미 승인돼 있어야 함)
  const tcode = (opt(i, '대회') || '').trim();
  if (tcode) {
    const link = await getGuildLink(i.guild_id);
    if (!link || link.status !== 'approved') return ephem('⚠️ 먼저 `/방연결 코드:<방코드>` 로 이 서버를 방에 연결하고 승인받아야 대회를 연결할 수 있어요.');
    const t = await getTournamentByCode(tcode);
    if (!t) return ephem(`"${tcode}" 코드의 대회를 못 찾았어요. 사이트 대회 **관리자 탭**에서 코드를 확인하세요.`);
    await linkGuildTournament(i.guild_id, t.id);
    return ephem(`🏆 이 서버를 대회 **${t.name}** 에 연결했어요.\n이제 공지 띄울 채널에서 \`/대회공지 연결\` 을 실행하면 대진·결과가 자동 공지돼요.`);
  }
  const code = (opt(i, '코드') || '').trim();
  if (!code) return ephem('방 코드 또는 대회 코드를 입력하세요.\n• 내전 방: `/방연결 코드:빙수`\n• 대회: `/방연결 대회:ABC123`');
  const group = await getGroupByCode(code);
  if (!group) return ephem(`"${code}" 코드의 방을 못 찾았어요. 사이트에서 방 코드를 확인하세요.`);
  const existing = await getGuildLink(i.guild_id);
  if (existing?.status === 'approved' && existing.group_id === group.id) return ephem(`이미 **${group.name || group.code}** 에 연결돼 있어요.`);
  const requester = i.member?.user?.global_name || i.member?.user?.username || callerId(i);
  const g = await fetchGuildBrand(i.guild_id); // 서버 이름·아이콘 → 사이트 헤더 브랜딩용
  await requestGuildLink(i.guild_id, group.id, requester, g?.name || null, g?.icon || null);
  return ephem(`📨 **${group.name || group.code}** (#${group.code}) 연결 **요청**을 보냈어요.\n방장/관리자가 **사이트 → 점수표(설정) 페이지**에서 승인하면 이 서버에서 커맨드를 쓸 수 있어요. (승인 전까지는 대기)`);
}

// /대회공지 연결·해제 — 이 채널을 (서버에 연결된)대회의 공지채널로. 서버관리자만.
async function cmdTourneyNotice(i, gid) {
  if (!i.guild_id) return ephem('서버(길드) 안에서만 쓸 수 있어요.');
  const perms = BigInt(i.member?.permissions || '0');
  const canManage = (perms & 0x20n) !== 0n || (perms & 0x8n) !== 0n;
  if (!canManage) return ephem('⚠️ 서버 관리 권한이 있는 사람만 설정할 수 있어요.');
  const link = await getGuildLink(i.guild_id);
  if (!link || link.status !== 'approved') return ephem('⚠️ 먼저 `/방연결` 로 서버를 연결·승인받아야 해요.');
  if (!link.tournament_id) return ephem('⚠️ 이 서버에 연결된 대회가 없어요. 먼저 `/방연결 대회:<코드>` 로 대회를 연결하세요.');
  const action = (opt(i, '동작') || '연결').trim();
  if (action === '해제') {
    await setGuildNoticeChannel(i.guild_id, null);
    return ephem('🔕 대회 공지 채널을 해제했어요. (자동 공지 off)');
  }
  await setGuildNoticeChannel(i.guild_id, i.channel_id);
  return ephem(`📢 이 채널을 **대회 공지 채널**로 설정했어요.\n대진 확정·경기 결과가 여기로 자동 공지돼요. 끄려면 \`/대회공지 동작:해제\`.`);
}

// /관리자 — 서버 관리자가 봇 관리자(비-서버관리자)에게 /기록 권한 부여/해제/목록
async function cmdAdmin(i, gid) {
  if (!isServerAdmin(i)) return ephem('⚠️ 서버 관리자(서버 관리 권한)만 관리자를 지정할 수 있어요.');
  const action = opt(i, '동작');
  if (action === '목록') {
    const list = await listBotAdmins(gid);
    const body = list.length
      ? '🛡 **봇 관리자** (서버 관리자 외 /기록 권한):\n' + list.map((a) => `• ${a.name || a.discord_id}${String(a.discord_id).startsWith('site:') ? '' : ` (<@${a.discord_id}>)`}`).join('\n')
      : '아직 지정된 봇 관리자가 없어요. (서버 관리자는 기본으로 `/기록` 가능)';
    return ephem(body);
  }
  const userId = opt(i, '유저');
  if (!userId) return ephem('대상 유저를 선택하세요. 예: `/관리자 동작:승격 유저:@사람`');
  const u = i.data?.resolved?.users?.[userId];
  const name = u?.global_name || u?.username || null;
  try {
    if (action === '승격') { await grantBotAdmin(gid, userId, name, callerId(i)); return ephem(`✅ <@${userId}> 님을 **봇 관리자**로 승격했어요. 이제 \`/기록\` 을 쓸 수 있어요.`); }
    if (action === '해제') { await revokeBotAdmin(gid, userId); return ephem(`✅ <@${userId}> 님의 봇 관리자 권한을 **해제**했어요.`); }
  } catch (e) { return ephem('실패: ' + e.message); }
  return ephem('동작을 선택하세요 (승격 / 해제 / 목록).');
}

// ── 신고 (비공개 · 운영자만 조회 · 판단용 축적) ──
const REPORT_CAT = { noshow: '노쇼/잠수', troll: '트롤/대리', toxic: '비매너/욕설', other: '기타' };
// 신고 알림 → 지정된 비공개 신고 채널에 임베드 포스팅 (best-effort). 채널 미설정이면 조용히 스킵.
async function postReportNotice(guildId, r) {
  try {
    const ch = await getGuildReportChannel(guildId);
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!ch || !token) return;
    const embed = {
      title: '🚨 새 신고 접수', color: 0xc84f4f,
      fields: [
        { name: '대상', value: r.targetDiscordId ? `<@${r.targetDiscordId}>${r.targetName ? ` (${r.targetName})` : ''}` : (r.targetName || '?'), inline: true },
        { name: '사유', value: REPORT_CAT[r.category] || r.category, inline: true },
        { name: '신고자', value: r.reporterName || (r.reporterDiscordId ? `<@${r.reporterDiscordId}>` : '?'), inline: true },
        ...(r.detail ? [{ name: '내용', value: r.detail.slice(0, 1000) }] : []),
      ],
      footer: { text: '운영진 전용 · /신고목록 또는 사이트에서 누적 확인' },
    };
    await fetch(`https://discord.com/api/v10/channels/${ch}/messages`, {
      method: 'POST', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    });
  } catch { /* 알림 실패해도 신고는 저장됨 */ }
}
async function cmdReport(i, gid) {
  const targetId = opt(i, '대상');
  if (!targetId) return ephem('신고할 대상을 선택하세요. 예: `/신고 대상:@사람 사유:노쇼/잠수`');
  if (targetId === callerId(i)) return ephem('본인은 신고할 수 없어요.');
  const category = opt(i, '사유') || 'other';
  const detail = (opt(i, '내용') || '').trim();
  const u = i.data?.resolved?.users?.[targetId];
  const targetName = u?.global_name || u?.username || null;
  const meU = i.member?.user || i.user;
  const reporterName = i.member?.nick || meU?.global_name || meU?.username || null;
  const rec = { gid, reporterDiscordId: callerId(i), reporterName, targetDiscordId: targetId, targetName, category, detail };
  try {
    await createReport(rec);
  } catch (e) { return ephem('신고 접수 실패: ' + e.message); }
  waitUntil(postReportNotice(i.guild_id, rec)); // 관리자 알림(비공개 채널), 백그라운드
  return ephem(`🚨 신고 접수됐어요 — **운영자에게만** 전달되고 공개되지 않아요.\n대상: <@${targetId}> · 사유: ${REPORT_CAT[category] || category}\n⚠️ 무고·보복성 신고는 운영자가 신고자도 함께 확인해요.`);
}

// 봇 토큰으로 채널에 메시지 시도 → 성공여부 반환 (권한 진단용).
async function tryPostToChannel(channelId, payload) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !channelId) return false;
  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
    });
    return r.ok;
  } catch { return false; }
}

// 이 채널을 비공개 신고 알림 채널로 설정/해제 (운영진만)
async function cmdReportChannel(i, gid) {
  if (!isModerator(i) && !(await isBotAdmin(gid, callerId(i)))) return ephem('⚠️ 운영진(관리자·추방·차단 권한)만 신고 채널을 설정할 수 있어요.');
  const action = opt(i, '동작') || '연결';
  try {
    if (action === '해제') { await setGuildReportChannel(i.guild_id, null); return ephem('🔕 신고 알림 채널을 해제했어요. (신고는 계속 쌓이고 `/신고목록`·사이트에서 볼 수 있어요)'); }
    await setGuildReportChannel(i.guild_id, i.channel_id);
  } catch (e) { return ephem('설정 실패: ' + e.message); }
  // 실제로 이 채널에 봇이 글을 쓸 수 있는지 즉시 확인 (권한 진단)
  const posted = await tryPostToChannel(i.channel_id, { content: '🚨 이 채널이 **신고 알림 채널**로 설정됐어요. 새 신고가 여기로 올라와요.' });
  if (!posted) {
    return ephem('⚠️ 채널은 지정했는데 **봇이 이 채널에 글을 못 써요.**\n이 채널(또는 상위 카테고리) 권한에서 내전봇(또는 봇 역할)에게 **채널 보기 · 메시지 보내기 · 링크 첨부**를 켜주세요. 그러면 신고가 여기로 옵니다.\n(봇 토큰이 서버에 설정 안 됐어도 이럴 수 있어요.)');
  }
  return ephem('🚨 이 채널을 신고 알림 채널로 설정했어요 — 방금 **확인 메시지**를 이 채널에 올렸어요(보이면 정상). ⚠️ 이 채널은 운영진만 보이게 권한 잠가주세요.');
}

async function cmdReports(i, gid) {
  if (!isModerator(i) && !(await isBotAdmin(gid, callerId(i)))) return ephem('⚠️ 신고 내역은 운영진(관리자·추방·차단 권한)만 볼 수 있어요.');
  const reports = await listReports(gid, { limit: 50 });
  if (!reports.length) return ephem('접수된 신고가 없어요.');
  const cnt = {};
  reports.forEach((r) => { const k = r.target_discord_id || r.target_name || '?'; (cnt[k] = cnt[k] || { n: 0, name: r.target_name, id: r.target_discord_id }).n += 1; });
  const nameLabel = (v) => v.name || (v.id ? `<@${v.id}>` : '?');
  const top = Object.values(cnt).sort((a, b) => b.n - a.n).slice(0, 10)
    .map((v, idx) => `${idx + 1}. ${nameLabel(v)} — **${v.n}건**`).join('\n');
  const recent = reports.slice(0, 12).map((r) => {
    const d = new Date(r.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const tgt = r.target_name || (r.target_discord_id ? `<@${r.target_discord_id}>` : '?');
    return `• ${REPORT_CAT[r.category] || r.category} · ${tgt}${r.detail ? ` — ${r.detail.slice(0, 50)}` : ''} _(신고: ${r.reporter_name || '?'}, ${d})_`;
  }).join('\n');
  const body = `🚨 **신고 내역** (운영자 전용 · 나만 보임)\n\n__누적 많은 대상__\n${top}\n\n__최근 신고__\n${recent}`;
  return ephem(body.length > 1900 ? body.slice(0, 1900) + '\n… (더 있음)' : body);
}

const HANDLERS = { 리더보드: cmdLeaderboard, 전적: cmdRecord, 내전적: cmdMyRecord, 연동: cmdLink, 가입: cmdRegister, 프로필: cmdProfile, 칭호: cmdAwards, 방: cmdRoom, 밸런스: cmdBalance, 모집: cmdRecruit, 기록: cmdMatchShot, 방연결: cmdLinkGuild, 대회공지: cmdTourneyNotice, 관리자: cmdAdmin, 신고: cmdReport, 신고목록: cmdReports, 신고채널: cmdReportChannel };

export async function POST(request) {
  const body = await request.text();
  if (!verifySignature(request.headers.get('x-signature-ed25519'), request.headers.get('x-signature-timestamp'), body)) {
    return new NextResponse('invalid request signature', { status: 401 });
  }
  const i = JSON.parse(body);
  if (i.type === 1) return NextResponse.json({ type: 1 }); // PING → PONG
  if (MAINTENANCE) return ephem('🔒 내전 밸런스 서비스를 닫았습니다.'); // 종료 중엔 명령·버튼 전부 차단
  if (i.type === 2) { // 슬래시 커맨드
    const h = HANDLERS[i.data?.name];
    if (!h) return ephem('알 수 없는 명령어예요.');
    const gid = await resolveGid(i); // 이 서버가 승인 연결한 방 (아니면 null)
    if (!gid && i.data?.name !== '방연결') {
      const link = i.guild_id ? await getGuildLink(i.guild_id) : null;
      if (link?.status === 'pending') return ephem('⏳ 방 연결 **승인 대기중**이에요. 방장이 사이트에서 승인하면 사용할 수 있어요.');
      return ephem('⚠️ 이 서버에 연결된 방이 없어요. `/방연결 코드:<방코드>` 로 요청하세요.');
    }
    try { return await h(i, gid); } catch (e) { return ephem('오류: ' + e.message); }
  }
  if (i.type === 3) { // 버튼·드롭다운 (모집 큐 / 스샷 판독)
    try { return await handleComponent(i); } catch (e) { return ephem('오류: ' + e.message); }
  }
  if (i.type === 5) { // 모달 제출 (스샷 판독 선수 수정)
    try { return await handleModalSubmit(i); } catch (e) { return ephem('오류: ' + e.message); }
  }
  return NextResponse.json({ type: 4, data: { content: '지원하지 않는 인터랙션' } });
}
