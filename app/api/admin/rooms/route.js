import { NextResponse } from 'next/server';
import { listAllGroupsAdmin } from '../../../../src/repo.js';
import { requireAdmin, errStatus } from '../../../../src/auth.js';

// 모든 방 목록 (관리자 전용)
export async function GET(request) {
  try {
    await requireAdmin(request);
    return NextResponse.json({ ok: true, rooms: await listAllGroupsAdmin() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
