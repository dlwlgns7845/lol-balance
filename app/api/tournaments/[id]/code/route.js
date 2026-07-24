// 대회 디코 연결 코드 조회/발급 (운영자만). 옛 대회(코드 없음)면 즉석 발급.
import { NextResponse } from 'next/server';
import { requireTournamentOwner, errStatus } from '../../../../../src/auth.js';
import { ensureTournamentCode } from '../../../../../src/repo-tournament.js';

export async function GET(request, { params }) {
  try {
    await requireTournamentOwner(request, params.id);
    const code = await ensureTournamentCode(params.id);
    return NextResponse.json({ ok: true, code });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
