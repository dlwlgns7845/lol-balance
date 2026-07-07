import { NextResponse } from 'next/server';
import { getMatchHistory } from '../../../src/repo.js';

export async function GET(request) {
  try {
    const u = new URL(request.url);
    const gid = u.searchParams.get('gid');
    const limit = Math.min(500, Number(u.searchParams.get('limit')) || 30);
    return NextResponse.json({ ok: true, ...(await getMatchHistory(gid, limit)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
