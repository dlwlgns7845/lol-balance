import { NextResponse } from 'next/server';
import { saveMatch } from '../../../src/repo.js';
import { requireEditor, errStatus } from '../../../src/auth.js';

export async function POST(request) {
  try {
    const body = await request.json();
    await requireEditor(request, body.group_id);
    const match = await saveMatch(body.group_id, {
      winner: body.winner, totalWeight: body.totalWeight, participants: body.participants,
      force: body.force, durationMin: body.durationMin, durationSec: body.durationSec,
      objectives: body.objectives, source: body.source, // 리플 상세(있을 때만)
    });
    if (match?.duplicate) return NextResponse.json({ ok: true, duplicate: true, matchId: match.matchId });
    return NextResponse.json({ ok: true, match });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
