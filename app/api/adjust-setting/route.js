import { NextResponse } from 'next/server';
import { getAdjustEnabled, setAdjustEnabled } from '../../../src/repo.js';
import { requireAdmin, errStatus } from '../../../src/auth.js';

// 저티어 자동보정 방 설정 — GET(공개 조회) / POST(관리자만 변경)
export async function GET(request) {
  const gid = new URL(request.url).searchParams.get('gid');
  return NextResponse.json({ ok: true, enabled: await getAdjustEnabled(gid) });
}

export async function POST(request) {
  try {
    await requireAdmin(request);
    const gid = new URL(request.url).searchParams.get('gid');
    const { enabled } = await request.json();
    await setAdjustEnabled(gid, enabled);
    return NextResponse.json({ ok: true, enabled: !!enabled });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
