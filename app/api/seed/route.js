// 닉네임 → 티어 추정. 룰: 과거 시즌(시즌말 배치) + 현재/과거 100판+ 시즌 중 최고티어.
// Riot 키 있으면 시즌별 솔랭 판수까지 정밀 검증(하이브리드). 없으면 op.gg 단독.
import { NextResponse } from 'next/server';
import { fetchTierEstimate } from '../../../src/opgg.js';
import { fetchTierEstimateHybrid, fetchRiotProfile, hasRiotKey } from '../../../src/riot.js';
import { hitLimit } from '../../../src/ratelimit.js';

export async function GET(request) {
  // 외부 API(Riot/op.gg) 쿼터 보호: IP당 분당 15회 (정상 사용 = 계정 추가할 때 한두 번)
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
    if (hasRiotKey()) {
      try {
        const hy = await fetchTierEstimateHybrid(name, tag, region);
        if (hy.found) return NextResponse.json(hy);
      } catch (e) { /* Riot 만료/레이트 → op.gg 폴백 */ }
    }
    const est = await fetchTierEstimate(name, tag, region);
    if (est.found) return NextResponse.json(est);
    if (hasRiotKey()) {
      const riot = await fetchRiotProfile(name, tag, region);
      if (riot.found) return NextResponse.json(riot);
    }
    return NextResponse.json(est);
  } catch (e) {
    return NextResponse.json({ found: false, error: '조회 실패: ' + e.message }, { status: 502 });
  }
}
