// 사이트 "오늘 내전(디코모집)" 미러: gid의 열린 큐 + 배정 상태를 실시간(폴링)으로 제공.
// discord_id 는 노출 안 함(least-data). 로그인 불필요 — 보기는 아무나(비로그인 밸런서와 동일 톤).
import { NextResponse } from 'next/server';
import { getOpenQueue, listSignups, listPersons, syncGuildNicks } from '../../../src/repo.js';
import { queueView } from '../../../src/discord-queue.js';

export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    await syncGuildNicks(gid); // 디코 서버별명 최신화 (45초 캐시)
    const queue = await getOpenQueue(gid);
    if (!queue) return NextResponse.json({ ok: true, queue: null });
    const signups = await listSignups(queue.id);
    const persons = await listPersons(gid);
    const pmap = new Map(); // discord_id 와 site:<personId> 둘 다로 조회 가능하게
    persons.forEach((p) => {
      const meta = { profile: p.profile || null, baseTier: p.base_tier, secTier: p.secondary_tier || null, primary: p.primary_positions || [], secondary: p.secondary_positions || [], nick: p.nickname || p.display_name };
      if (p.discord_id) pmap.set(p.discord_id, meta);
      pmap.set(`site:${p.id}`, meta);
    });
    return NextResponse.json({ ok: true, queue: { id: queue.id, size: queue.size, status: queue.status }, ...queueView(queue, signups, pmap) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
