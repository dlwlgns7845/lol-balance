import { NextResponse } from 'next/server';
import { getPlayerDetail } from '../../../../src/repo.js';

export async function GET(request, { params }) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    return NextResponse.json({ ok: true, ...(await getPlayerDetail(gid, params.id)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
