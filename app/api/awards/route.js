import { NextResponse } from 'next/server';
import { getAwards } from '../../../src/repo.js';

export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    return NextResponse.json({ ok: true, awards: await getAwards(gid) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
