import { NextResponse } from 'next/server';
import { saveMatch } from '../../../src/repo.js';
import { requireRecorder, errStatus } from '../../../src/auth.js';

export async function POST(request) {
  try {
    const body = await request.json();
    await requireRecorder(request, body.group_id);
    const match = await saveMatch(body.group_id, {
      winner: body.winner, totalWeight: body.totalWeight, participants: body.participants,
      force: body.force, durationMin: body.durationMin, durationSec: body.durationSec,
      objectives: body.objectives, source: body.source, // 리플 상세(있을 때만)
      played_at: body.played_at, // 리플 저장시각 = 게임 날짜 (일괄 업로드 날짜순 정렬)
    });
    if (match?.duplicate) return NextResponse.json({ ok: true, duplicate: true, matchId: match.matchId });
    return NextResponse.json({ ok: true, match });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
