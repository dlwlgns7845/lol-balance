import { NextResponse } from 'next/server';
import { getStats, syncGuildNicks } from '../../../src/repo.js';

export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    await syncGuildNicks(gid); // 디코 서버별명 최신화 (45초 캐시)
    return NextResponse.json({ ok: true, ...(await getStats(gid)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
