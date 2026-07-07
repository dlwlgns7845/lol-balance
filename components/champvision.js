// 챔피언 인식 (브라우저). 스코어보드에서 챔프 아이콘 crop → 실제 레퍼런스랑 정렬보정 매칭.
// "naejeon식": 같은 챔프는 같은 아트라, 정렬만 맞추면 정확히 매칭됨 (검증됨).

const ROWS0 = [206, 240, 274, 310, 346, 420, 455, 490, 525, 560]; // 1050x638 기준 행 y중심
const CX0 = 124;       // 챔프 아이콘 x중심 (1050 기준)
const SZ = 32, REGW = 48, REGH = 44;
export const MATCH_THRESHOLD = 1300000; // 이 거리 미만이면 "확신 매칭"

// 원형 마스크 (테두리 제외) 인덱스
const MASK = (() => {
  const m = []; const c = (SZ - 1) / 2, r2 = (SZ * 0.46) ** 2;
  for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) if ((x - c) ** 2 + (y - c) ** 2 <= r2) m.push(y * SZ + x);
  return m;
})();
const OFFS = [];
for (const dx of [-4, -2, 0, 2, 4]) for (const dy of [-4, -2, 0, 2, 4]) OFFS.push([dx, dy]);

// 이미지 → 10개 챔프 영역 (각 48x44 RGBA Uint8), 해상도 무관 정규화
export function regionsFromImage(img) {
  const W = img.naturalWidth, H = img.naturalHeight, sx = W / 1050, sy = H / 638;
  const big = document.createElement('canvas'); big.width = W; big.height = H;
  big.getContext('2d').drawImage(img, 0, 0);
  const out = [];
  for (const y0 of ROWS0) {
    const cx = Math.round(CX0 * sx), cy = Math.round(y0 * sy);
    const t = document.createElement('canvas'); t.width = REGW; t.height = REGH;
    t.getContext('2d').drawImage(big, cx - Math.round(REGW / 2 * sx), cy - Math.round(REGH / 2 * sy),
      Math.round(REGW * sx), Math.round(REGH * sy), 0, 0, REGW, REGH);
    out.push(t.getContext('2d').getImageData(0, 0, REGW, REGH).data);
  }
  return out;
}

// 밴 아이콘 중심 (1050x638 기준): 팀1 5개 → 팀2 5개. 정사각 아이콘이지만 같은 마스크로 매칭됨.
const BAN0 = [
  [872, 203], [936, 203], [999, 203], [872, 248], [936, 248], // 팀1
  [872, 417], [936, 417], [999, 417], [872, 462], [936, 462], // 팀2
];

// 이미지 → 10개 밴 영역 (팀1 5 + 팀2 5). 플레이어와 동일한 vecAt/matchChampion 재사용.
export function banRegionsFromImage(img) {
  const W = img.naturalWidth, H = img.naturalHeight, sx = W / 1050, sy = H / 638;
  const big = document.createElement('canvas'); big.width = W; big.height = H;
  big.getContext('2d').drawImage(img, 0, 0);
  const out = [];
  for (const [bx, by] of BAN0) {
    const cx = Math.round(bx * sx), cy = Math.round(by * sy);
    const t = document.createElement('canvas'); t.width = REGW; t.height = REGH;
    t.getContext('2d').drawImage(big, cx - Math.round(REGW / 2 * sx), cy - Math.round(REGH / 2 * sy),
      Math.round(REGW * sx), Math.round(REGH * sy), 0, 0, REGW, REGH);
    out.push(t.getContext('2d').getImageData(0, 0, REGW, REGH).data);
  }
  return out;
}

// 48x44 영역에서 (dx,dy) 오프셋의 32x32 마스크 벡터 (밝기 정규화)
function vecAt(data, dx, dy) {
  const n = MASK.length, v = new Float32Array(n * 3);
  const ox = 24 - 16 + dx, oy = 22 - 16 + dy;
  let sr = 0, sg = 0, sb = 0;
  for (let k = 0; k < n; k++) {
    const idx = MASK[k], y = (idx / SZ) | 0, x = idx % SZ;
    const p = ((oy + y) * REGW + (ox + x)) * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    v[k * 3] = r; v[k * 3 + 1] = g; v[k * 3 + 2] = b; sr += r; sg += g; sb += b;
  }
  const mr = sr / n, mg = sg / n, mb = sb / n;
  for (let k = 0; k < n; k++) { v[k * 3] -= mr; v[k * 3 + 1] -= mg; v[k * 3 + 2] -= mb; }
  return v;
}

// 저장용: 영역 중심 32x32 RGB → base64
export function encodeCenter(data) {
  const bytes = new Uint8Array(SZ * SZ * 3);
  const ox = 24 - 16, oy = 22 - 16;
  let j = 0;
  for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) {
    const p = ((oy + y) * REGW + (ox + x)) * 4;
    bytes[j++] = data[p]; bytes[j++] = data[p + 1]; bytes[j++] = data[p + 2];
  }
  let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// base64 → 레퍼런스 벡터 (32x32 중심, 마스크+정규화)
export function decodeRefVec(b64) {
  const s = atob(b64), n = MASK.length, v = new Float32Array(n * 3);
  let sr = 0, sg = 0, sb = 0;
  for (let k = 0; k < n; k++) {
    const idx = MASK[k], p = idx * 3;
    const r = s.charCodeAt(p), g = s.charCodeAt(p + 1), b = s.charCodeAt(p + 2);
    v[k * 3] = r; v[k * 3 + 1] = g; v[k * 3 + 2] = b; sr += r; sg += g; sb += b;
  }
  const mr = sr / n, mg = sg / n, mb = sb / n;
  for (let k = 0; k < n; k++) { v[k * 3] -= mr; v[k * 3 + 1] -= mg; v[k * 3 + 2] -= mb; }
  return v;
}

// 한 영역을 레퍼런스들과 매칭 → { champion, dist } (오프셋 탐색)
export function matchChampion(regionData, refs) {
  if (!refs.length) return null;
  // 후보 오프셋별 영역 벡터 미리 계산
  const cand = OFFS.map(([dx, dy]) => vecAt(regionData, dx, dy));
  let best = null;
  for (const ref of refs) {
    const rv = ref.vec, len = rv.length;
    let dmin = Infinity;
    for (const cv of cand) {
      let d = 0;
      for (let i = 0; i < len; i++) { const e = rv[i] - cv[i]; d += e * e; }
      if (d < dmin) dmin = d;
    }
    if (!best || dmin < best.dist) best = { champion: ref.champion, dist: dmin };
  }
  return best;
}
