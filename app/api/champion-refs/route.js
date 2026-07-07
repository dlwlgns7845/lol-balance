import { NextResponse } from 'next/server';
import { listChampionRefs, addChampionRefs } from '../../../src/repo.js';
import { requireAdmin, errStatus } from '../../../src/auth.js';

// ⚠️ 레거시: 아이콘 매칭 방식(champvision.js)용 — 현재는 GPT 비전이 챔프명을 텍스트로 읽어 미사용.
// champion_refs는 전역 공유 테이블이라 쓰기는 관리자 전용으로 잠금.

// GET ?kind=player|ban
export async function GET(request) {
  try {
    const kind = new URL(request.url).searchParams.get('kind') || 'player';
    return NextResponse.json({ ok: true, refs: await listChampionRefs(kind) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST { items: [{ champion, vec }], kind?: 'player'|'ban' } — 관리자 전용
export async function POST(request) {
  try {
    await requireAdmin(request);
    const { items, kind } = await request.json();
    await addChampionRefs(items, kind || 'player');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
