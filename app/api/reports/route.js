import { NextResponse } from 'next/server';
import { listReports, setReportStatus } from '../../../src/repo.js';
import { requireEditor, errStatus } from '../../../src/auth.js';

// 신고 목록 (운영자 전용). gid 필수.
export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    if (!gid) throw new Error('gid 필요');
    await requireEditor(request, gid); // 방장/편집자/관리자만
    return NextResponse.json({ ok: true, reports: await listReports(gid, { limit: 200 }) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}

// 신고 상태 변경 (확인/기각/제재) — 운영자 전용. body: { gid, id, status }
export async function PATCH(request) {
  try {
    const { gid, id, status } = await request.json();
    if (!gid || !id) throw new Error('gid·id 필요');
    await requireEditor(request, gid);
    await setReportStatus(id, status);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
