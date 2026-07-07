// Supabase 연결 확인용. 연결 여부(boolean)만 반환 — 데이터/카운트 노출 안 함.
import { NextResponse } from 'next/server';
import { db } from '../../../src/supabase.js';

export async function GET() {
  try {
    const { error } = await db().from('persons').select('id', { head: true }).limit(1);
    return NextResponse.json({ ok: !error });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
