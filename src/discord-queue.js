// 내전 모집 큐 — 디코 메시지 렌더 + 배정 + 사이트↔디코 동기화 (route.js·사이트 API 공유)
import { allocateQueue, LANES } from './queue.js';

export const LANE_KR = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', sup: '서폿' };
const GOLD = 0xe8c07d;

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
    return { id: s?.id, name: s?.name || '?', main: s?.main, sub: s?.sub || null, off: !!(s && lane && s.main !== lane), tier: p?.tier || null, profile: p?.profile || null, lane };
  };
  const lanes = {};
  LANES.forEach((l) => { lanes[l] = alloc.lanes[l].map((id) => map(id, l)); });
  const waitlist = alloc.waitlist.map((id) => map(id, null));
  return { size: queue.size, slotsPerLane: N, count: signups.length, lanes, waitlist };
}

// 디코 버튼/드롭다운 (라인당 선착순)
export function queueComponents(qid) {
  const btn = (custom_id, label, style) => ({ type: 2, style, label, custom_id });
  return [
    { type: 1, components: LANES.map((l) => btn(`qm:${qid}:${l}`, LANE_KR[l], 1)) },
    { type: 1, components: [{ type: 3, custom_id: `qs:${qid}`, placeholder: '부라인 선택 (선택 · 없어도 됨)',
      options: [{ label: '부라인 없음', value: 'none' }, ...LANES.map((l) => ({ label: LANE_KR[l], value: l }))] }] },
    { type: 1, components: [btn(`ql:${qid}`, '❌ 나가기', 4), btn(`qc:${qid}`, '🔒 마감', 2)] },
  ];
}

// 디코 메시지 본문 { embeds, components } — 슬래시 응답(type4)·버튼 갱신(type7)·사이트 되쓰기 공용
export function queueMessage(queue, signups, closed) {
  const N = Math.max(1, Math.floor(queue.size / 5));
  const alloc = allocateSignups(queue, signups);
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

// 사이트→디코: 저장된 채널/메시지를 봇토큰으로 PATCH (양방향 동기화). 토큰/ID 없으면 조용히 스킵.
export async function syncDiscordMessage(queue, signups) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !queue?.channel_id || !queue?.message_id) return { synced: false };
  const body = queueMessage(queue, signups, queue.status !== 'open');
  const r = await fetch(`https://discord.com/api/v10/channels/${queue.channel_id}/messages/${queue.message_id}`, {
    method: 'PATCH', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { synced: r.ok };
}
