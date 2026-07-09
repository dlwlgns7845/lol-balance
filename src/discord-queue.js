// 내전 모집 큐 — 디코 메시지 렌더 + 배정 + 사이트↔디코 동기화 (route.js·사이트 API 공유)
import { allocateQueue, LANES, subLanesOf } from './queue.js';
import { TABLE, POS } from './table.js';

// 마감 시 라인배정 로스터 → 균형 2팀 후보 랭킹 (10인만). personMap: discord_id → { tier, secondaryTier }.
// 라인0을 A로 고정(미러 중복 제거) + 라인1~4 조합(2^4=16) → 점수차 오름차순. 라인당 2명 아니면 [].
export function buildTeamsRanked(queue, signups, personMap) {
  if (queue.size !== 10) return [];
  const alloc = allocateSignups(queue, signups);
  for (const l of LANES) if (alloc.lanes[l].length !== 2) return [];
  const info = new Map(signups.map((s) => [s.discord_id, s]));
  const cell = (id, lane) => {
    const s = info.get(id); const p = personMap?.get(id) || {};
    const tier = effTier(p, lane) || 'G2'; // 배정 라인이 부라인(사람관리)이면 부라인티어
    const idx = POS.indexOf(lane);
    let pts = (TABLE[tier]?.[idx] ?? 15);
    if (s?.main === 'all') pts -= 1; // ALL(아무 라인 양보) → 점수 −1 혜택 (자리 채워주는 보상)
    return { pts, tier, name: s?.name || '?', discordId: id, lane };
  };
  const laneP = LANES.map((l) => alloc.lanes[l].map((id) => cell(id, l)));
  const out = [];
  for (let mask = 0; mask < 16; mask++) {
    const A = [], B = []; let sa = 0, sb = 0;
    LANES.forEach((l, i) => {
      const [x, y] = laneP[i];
      const flip = i === 0 ? 0 : (mask >> (i - 1)) & 1; // 라인0 고정 → 미러 제거
      const a = flip ? y : x, b = flip ? x : y;
      A.push(a); sa += a.pts; B.push(b); sb += b.pts;
    });
    out.push({ A, B, sumA: sa, sumB: sb, diff: Math.abs(sa - sb) });
  }
  out.sort((a, b) => a.diff - b.diff);
  return out;
}
export function buildTeams(queue, signups, personMap) { return buildTeamsRanked(queue, signups, personMap)[0] || null; }

export const LANE_KR = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', sup: '서폿' };
const GOLD = 0xe8c07d;

// 디코 큐 표시용 메타: discord_id·site:personId → { tier, game(인게임닉), tag }. persons(계정 포함) 필요.
export function buildMetaMap(persons) {
  const m = new Map();
  (persons || []).forEach((p) => {
    const acc = (p.accounts || []).find((a) => a.is_main) || (p.accounts || [])[0];
    const meta = {
      game: acc?.game_name || null, tag: acc?.tag_line || null,
      baseTier: p.base_tier, secTier: p.secondary_tier || null,
      primary: p.primary_positions || [], secondary: p.secondary_positions || [],
    };
    if (p.discord_id) m.set(p.discord_id, meta);
    m.set(`site:${p.id}`, meta);
  });
  return m;
}

// 배정 라인이 그 사람 부라인(사람관리 secondary, primary엔 없음)이면 부라인 티어, 아니면 기본 티어
export function effTier(meta, lane) {
  if (!meta) return null;
  if (lane && meta.secTier && meta.secondary?.includes(lane) && !meta.primary?.includes(lane)) return meta.secTier;
  return meta.baseTier || null;
}

// signups(created_at 순) → 배정 결과 { lanes, waitlist } (id = discord_id)
export function allocateSignups(queue, signups) {
  const input = signups.map((s, idx) => ({ id: s.discord_id, main: s.main, sub: s.sub || null, order: idx }));
  return allocateQueue(input, queue.size);
}

// 사이트용 구조화 뷰: 라인별 배정 인원 + 대기 (discord_id 는 노출 안 함 — least-data).
// personMap: discord_id → { tier } (팀짜기용). 없으면 tier 생략.
export function queueView(queue, signups, personMap) {
  const N = Math.max(1, Math.floor(queue.size / 5));
  const alloc = allocateSignups(queue, signups);
  const byId = new Map(signups.map((s) => [s.discord_id, s]));
  const map = (id, lane) => {
    const s = byId.get(id);
    const p = personMap && personMap.get(id);
    return { id: s?.id, name: p?.nick || s?.name || '?', main: s?.main, sub: s?.sub || null, off: !!(s && lane && s.main !== lane && s.main !== 'all'), all: s?.main === 'all', tier: effTier(p, lane), profile: p?.profile || null, lane };
  };
  const lanes = {};
  LANES.forEach((l) => { lanes[l] = alloc.lanes[l].map((id) => map(id, l)); });
  const waitlist = alloc.waitlist.map((id) => map(id, null));
  return { size: queue.size, slotsPerLane: N, count: signups.length, lanes, waitlist };
}

// 디코 버튼/드롭다운 (라인당 선착순)
export function queueComponents(qid) {
  const btn = (custom_id, label, style) => ({ type: 2, style, label, custom_id });
  const laneBtns = LANES.map((l) => btn(`qm:${qid}:${l}`, LANE_KR[l], 1));
  // ALL: 라인 5개 아래 줄. 디코는 버튼 폭 지정 불가 → 라벨을 넓게 패딩(　)해 위 5버튼 폭에 근접시킴.
  const allBtn = btn(`qm:${qid}:all`, '　　🌐 ALL · 아무 라인이나 (점수 −1 혜택)　　', 1);
  return [
    { type: 1, components: laneBtns },  // 탑 정글 미드 원딜 서폿 (한 줄 · 서폿 안 밀림)
    { type: 1, components: [allBtn] },  // ALL (아랫줄 · 넓게)
    { type: 1, components: [{ type: 3, custom_id: `qs:${qid}`, placeholder: '부/대기 라인 (여러 개 선택 가능 · 없어도 됨)',
      min_values: 0, max_values: LANES.length,
      options: LANES.map((l) => ({ label: LANE_KR[l], value: l })) }] },
    { type: 1, components: [btn(`ql:${qid}`, '❌ 나가기', 4), btn(`qc:${qid}`, '🔒 마감', 2)] },
  ];
}

// 디코 메시지 본문 { embeds, components } — 슬래시 응답(type4)·버튼 갱신(type7)·사이트 되쓰기 공용.
// closed + teams 있으면 확정 2팀을 필드로 표시.
export function queueMessage(queue, signups, closed, teams, teamIdx = 0, teams20 = null, metaMap = null, teamTotal = 1, confirmed = false) {
  const N = Math.max(1, Math.floor(queue.size / 5));
  const alloc = allocateSignups(queue, signups);
  const info = new Map(signups.map((s) => [s.discord_id, s]));
  // 슬롯 한 줄: "1. 인게임닉 #태그 (@디코) `티어` · 부라인" / 비면 "1. 비어있음"
  const slotLine = (id, lane, n) => {
    if (!id) return `${n}. \`비어있음\``;
    const s = info.get(id);
    const m = metaMap?.get(id) || {};
    const riot = m.game ? `${m.game}${m.tag ? ` #${m.tag}` : ''}` : (s?.name || '?');
    const mention = (id && !String(id).startsWith('site:')) ? ` (<@${id}>)` : '';
    const et = effTier(m, lane); // 배정 라인 맞는 티어(부라인이면 부라인티어)
    const tier = et ? ` \`${et}\`` : '';
    let role = '';
    if (s?.main === 'all') role = ' · 올라운더';
    else if (s && s.main !== lane) role = ` · 부(원래 ${LANE_KR[s.main]})`;
    else if (s?.sub) role = ` · 부:${s.sub === 'all' ? 'ALL' : subLanesOf(s).map((l) => LANE_KR[l]).join('/')}`; // 큐에서 고른 부라인(여러 개)
    return `${n}. **${riot}**${mention}${tier}${role}`;
  };
  // 대기자가 '받을 라인' 목록 (주라인 + 선택한 여러 라인, 올라운더면 전체)
  const acceptText = (s) => (s.main === 'all'
    ? LANES.map((l) => LANE_KR[l]).join('/')
    : [s.main, ...subLanesOf(s)].map((l) => LANE_KR[l]).join('/'));
  const lines = LANES.map((l) => {
    const ids = alloc.lanes[l];
    const dot = ids.length >= N ? '🔵' : (ids.length ? '🟢' : '⬜');
    const slots = [];
    for (let n = 0; n < N; n++) slots.push('　' + slotLine(ids[n], l, n + 1));
    return `${dot} **${LANE_KR[l]}**\n${slots.join('\n')}`;
  });
  const wait = alloc.waitlist.map((id, k) => {
    const s = info.get(id);
    const m = metaMap?.get(id) || {};
    const riot = m.game ? `${m.game}${m.tag ? ` #${m.tag}` : ''}` : (s?.name || '?');
    const mention = (id && !String(id).startsWith('site:')) ? ` (<@${id}>)` : '';
    const et = m.baseTier ? ` \`${m.baseTier}\`` : '';
    return `　${k + 1}. **${riot}**${mention}${et} · 받는 라인: ${s ? acceptText(s) : '?'}`;
  });
  // 팀 셀 한 줄: "탑 · 인게임닉 #태그 (@디코) `티어`" — 모집과 같은 큰 포맷
  const teamCell = (p) => {
    const m = metaMap?.get(p.discordId) || {};
    const riot = m.game ? `${m.game}${m.tag ? ` #${m.tag}` : ''}` : p.name;
    const mention = (p.discordId && !String(p.discordId).startsWith('site:')) ? ` (<@${p.discordId}>)` : '';
    return `${LANE_KR[p.lane]} · **${riot}**${mention} \`${p.tier || '?'}\``;
  };
  const intro = closed ? '' : '참가할 **포지션 버튼**을 누르세요. (등록 안 됐으면 먼저 `/가입` 또는 `/연동`)\n\n';
  let desc;
  if (closed && teams) desc = confirmed
    ? `✅ **팀 확정 완료!** · 조합 ${teamIdx + 1}/${teamTotal} · 점수차 ${teams.diff.toFixed(1)} · 전원 호출됨`
    : `**팀 미리보기** · 총 ${teamTotal}개 조합 중 ${teamIdx + 1}번째 · 점수차 ${teams.diff.toFixed(1)}\n◀ / ▶ 로 다른 조합 보고 → ✅ 확정을 누르면 전원 호출`;
  else if (closed && teams20) desc = '**팀 확정** · 고저분리 4팀';
  else {
    desc = intro + lines.join('\n');
    if (wait.length) desc += `\n\n⏳ **대기표** (${wait.length}명) · _자리 나면 받는 라인 중 빈 곳으로 자동 승격_\n${wait.join('\n')}`;
  }
  const embed = {
    title: `🎮 롤 내전 대기열 · ${queue.size}인${closed ? ' · 마감됨' : ` (${signups.length}/${queue.size})`}`,
    description: desc, color: GOLD,
    footer: closed ? undefined : { text: '포지션 버튼=참가 · 부라인 드롭다운(선택) · 라인 다시 눌러 변경 · ❌ 나가기' },
  };
  if (closed && teams) {
    embed.fields = [
      { name: `🟦 블루 (${Math.round(teams.sumA)})`, value: teams.A.map(teamCell).join('\n'), inline: false },
      { name: `🟥 레드 (${Math.round(teams.sumB)})`, value: teams.B.map(teamCell).join('\n'), inline: false },
    ];
    embed.title += ' · 팀 확정';
  }
  if (closed && teams20) { // 20인 고저분리 4팀
    const gameField = (game, label) => {
      const c = game.candidates[0];
      const side = (T) => c.lanes.map((l) => `${LANE_KR[l.pos]} · **${l[T].name}** \`${l[T].tier || '?'}\``).join('\n');
      return { name: label, value: `🟦 **블루** (${c.sumA.toFixed(0)})\n${side('a')}\n\n🟥 **레드** (${c.sumB.toFixed(0)})\n${side('b')}`, inline: true };
    };
    embed.fields = [gameField(teams20.games[0], '🔺 고티어 게임'), gameField(teams20.games[1], '🔻 저티어 게임')];
    embed.title += ' · 고저분리 4팀';
  }
  let closedComponents = [];
  if (closed && teams && confirmed) {
    closedComponents = [{ type: 1, components: [
      { type: 2, style: 3, label: '✅ 팀 확정 완료 · 전원 호출됨', custom_id: `tx:${queue.id}`, disabled: true },
    ] }];
  } else if (closed && teams) {
    closedComponents = [
      { type: 1, components: [
        { type: 2, style: 2, label: '◀ 이전 조합', custom_id: `tr:${queue.id}:${teamIdx}:p`, disabled: teamTotal <= 1 },
        { type: 2, style: 1, label: `${teamIdx + 1} / ${teamTotal}`, custom_id: `tr:${queue.id}:${teamIdx}:x`, disabled: true },
        { type: 2, style: 2, label: '다음 조합 ▶', custom_id: `tr:${queue.id}:${teamIdx}:n`, disabled: teamTotal <= 1 },
      ] },
      { type: 1, components: [
        { type: 2, style: 3, label: '✅ 이 조합으로 확정 · 전원 호출', custom_id: `tc:${queue.id}:${teamIdx}` },
      ] },
    ];
  }
  return { embeds: [embed], components: closed ? closedComponents : queueComponents(queue.id), allowed_mentions: { parse: [] } };
}

// 사이트→디코: 저장된 채널/메시지를 봇토큰으로 PATCH (양방향 동기화). 토큰/ID 없으면 조용히 스킵.
export async function syncDiscordMessage(queue, signups, metaMap = null) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !queue?.channel_id || !queue?.message_id) return { synced: false };
  const body = queueMessage(queue, signups, queue.status !== 'open', null, 0, null, metaMap);
  const r = await fetch(`https://discord.com/api/v10/channels/${queue.channel_id}/messages/${queue.message_id}`, {
    method: 'PATCH', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { synced: r.ok };
}
