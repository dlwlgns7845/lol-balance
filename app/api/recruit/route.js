// 사이트 "오늘 내전(디코모집)" 미러: gid의 열린 큐 + 배정 상태를 실시간(폴링)으로 제공.
// discord_id 는 노출 안 함(least-data). 로그인 불필요 — 보기는 아무나(비로그인 밸런서와 동일 톤).
import { NextResponse } from 'next/server';
import { getOpenQueue, listSignups } from '../../../src/repo.js';
import { queueView } from '../../../src/discord-queue.js';

export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    const queue = await getOpenQueue(gid);
    if (!queue) return NextResponse.json({ ok: true, queue: null });
    const signups = await listSignups(queue.id);
    return NextResponse.json({ ok: true, queue: { id: queue.id, size: queue.size, status: queue.status }, ...queueView(queue, signups) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
