import { NextResponse } from 'next/server';
import { extractScoreboard } from '../../../src/vision.js';
import { requireEditor, errStatus } from '../../../src/auth.js';
import { hitLimit } from '../../../src/ratelimit.js';

export const maxDuration = 60;

// POST { gid, image: "data:image/...;base64,..." }
export async function POST(request) {
  try {
    await hitLimit(request, 'extract', 8, 60); // GPT 쿼터 보호: IP당 분당 8회 (레거시 오픈 방 대비)
    const { gid, image } = await request.json();
    if (!image) throw new Error('이미지가 없습니다');
    await requireEditor(request, gid); // 무료 GPT 쿼터 보호 — 편집자만 분석 실행
    return NextResponse.json({ ok: true, data: await extractScoreboard(image) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
