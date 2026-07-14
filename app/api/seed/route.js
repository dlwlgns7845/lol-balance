// 닉네임 → 티어 추정 (op.gg 단일 소스). 현재/전시즌/역대 최고 티어·판수·레벨.
// Riot API는 쓰지 않음 — op.gg가 상위호환(역대 티어 제공) + 상업(광고) 유연성.
import { NextResponse } from 'next/server';
import { fetchTierEstimate } from '../../../src/opgg.js';
import { hitLimit } from '../../../src/ratelimit.js';

export async function GET(request) {
  // op.gg 쿼터 보호: IP당 분당 15회 (정상 사용 = 계정 추가할 때 한두 번)
  try { await hitLimit(request, 'seed', 15, 60); }
  catch (e) { return NextResponse.json({ found: false, error: e.message }, { status: 429 }); }
  const { searchParams } = new URL(request.url);
  const name = (searchParams.get('name') || '').trim();
  const tag = (searchParams.get('tag') || '').trim();
  const region = (searchParams.get('region') || 'NA').trim();
  if (!name || !tag) {
    return NextResponse.json({ found: false, error: 'gameName과 tag가 필요합니다' }, { status: 400 });
  }
  try {
    return NextResponse.json(await fetchTierEstimate(name, tag, region));
  } catch (e) {
    return NextResponse.json({ found: false, error: '조회 실패: ' + e.message }, { status: 502 });
  }
}
