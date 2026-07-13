import { NextResponse } from 'next/server';
import { deleteMatch, getMatchForEdit, updateMatch, swapSides } from '../../../../src/repo.js';
import { requireEditor, errStatus } from '../../../../src/auth.js';

// 편집용 경기 로드 (편집자+)
export async function GET(request, { params }) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    await requireEditor(request, gid);
    return NextResponse.json({ ok: true, match: await getMatchForEdit(params.id) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}

// 경기 수정 (편집자+)
export async function PATCH(request, { params }) {
  try {
    const body = await request.json();
    await requireEditor(request, body.group_id);
    if (body.action === 'swapSides') { // 블루↔레드 뒤집기
      const match = await swapSides(body.group_id, params.id);
      return NextResponse.json({ ok: true, match });
    }
    const match = await updateMatch(body.group_id, params.id, {
      winner: body.winner, participants: body.participants, durationMin: body.durationMin, durationSec: body.durationSec,
    });
    return NextResponse.json({ ok: true, match });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}

export async function DELETE(request, { params }) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    await requireEditor(request, gid);
    await deleteMatch(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
