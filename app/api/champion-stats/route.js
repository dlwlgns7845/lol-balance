import { NextResponse } from 'next/server';
import { getChampionStats } from '../../../src/repo.js';

export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    return NextResponse.json({ ok: true, ...(await getChampionStats(gid)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
