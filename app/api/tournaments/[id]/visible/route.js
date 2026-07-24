// 대회 공개/숨김 (전역 관리자만) — 새 대회 승인·노출 제어.
import { NextResponse } from 'next/server';
import { requireAdmin, errStatus } from '../../../../../src/auth.js';
import { setTournamentVisible } from '../../../../../src/repo-tournament.js';

export async function POST(request, { params }) {
  try {
    await requireAdmin(request);
    const { visible } = await request.json();
    await setTournamentVisible(params.id, visible);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
