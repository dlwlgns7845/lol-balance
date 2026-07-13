import { NextResponse } from 'next/server';
import { submitScoreTeam } from '../../../../../src/repo-tournament.js';
import { getUser, errStatus } from '../../../../../src/auth.js';

// 점수제 팀 제출 (로그인 필요 — 신청자들이 상한 안에서 팀 맞춰 제출)
export async function POST(request, { params }) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 });
    const body = await request.json();
    return NextResponse.json({ ok: true, ...(await submitScoreTeam(params.id, body)) });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
