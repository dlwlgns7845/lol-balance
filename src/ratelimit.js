// 레이트리밋 (서버 전용). Upstash Redis(REST) 설정 시 전역 하드가드,
// 없으면 인메모리 폴백 — 서버리스 인스턴스별이라 speed bump일 뿐, 하드가드가 필요하면 Upstash 켜기.
// 고정 윈도우(IP 단위): 키에 윈도우 인덱스를 포함해 윈도우가 바뀌면 자동 리셋.

const mem = new Map(); // key → { n, reset(ms) }

function pruneMem(now) {
  if (mem.size < 2000) return;
  for (const [k, v] of mem) if (v.reset <= now) mem.delete(k);
}
function memCount(key, now) {
  const v = mem.get(key);
  return v && v.reset > now ? v.n : 0;
}
function memIncr(key, windowSec, now) {
  const v = mem.get(key);
  if (!v || v.reset <= now) { pruneMem(now); mem.set(key, { n: 1, reset: now + windowSec * 1000 }); return 1; }
  v.n += 1;
  return v.n;
}

function upstashCfg() {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
async function upstashPipeline(cfg, cmds) {
  const r = await fetch(cfg.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('Upstash HTTP ' + r.status);
  return r.json(); // [{ result }, ...]
}

const winKey = (key, windowSec) => `rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;

// 현재 카운트 (증가 없음). Redis 장애 시 0 반환 — 리밋 때문에 서비스가 죽지 않게 fail-open.
async function count(key, windowSec) {
  const cfg = upstashCfg();
  const k = winKey(key, windowSec);
  if (!cfg) return memCount(k, Date.now());
  try {
    const [g] = await upstashPipeline(cfg, [['GET', k]]);
    return Number(g?.result) || 0;
  } catch { return memCount(k, Date.now()); }
}

// 1 증가 후 카운트 반환
async function incr(key, windowSec) {
  const cfg = upstashCfg();
  const k = winKey(key, windowSec);
  if (!cfg) return memIncr(k, windowSec, Date.now());
  try {
    const [i] = await upstashPipeline(cfg, [['INCR', k], ['EXPIRE', k, windowSec + 1]]);
    return Number(i?.result) || 1;
  } catch { return memIncr(k, windowSec, Date.now()); }
}

export function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'local';
}

const tooMany = () => { const e = new Error('요청이 너무 많아요 — 잠시 후 다시 시도하세요'); e.status = 429; return e; };

// 요청 1건 소비. 한도 초과면 429 throw. (윈도우당 limit회)
export async function hitLimit(request, bucket, limit, windowSec) {
  const n = await incr(`${bucket}:${clientIp(request)}`, windowSec);
  if (n > limit) throw tooMany();
}

// 읽기 전용 검사 — recordFail과 짝. 실패(오답)만 세는 카운터가 한도에 닿으면 429 throw.
// 정상 사용자는 카운터를 안 올리므로 오탐 없음 (방코드 브루트포스 차단용).
export async function checkLimit(request, bucket, limit, windowSec) {
  const n = await count(`${bucket}:${clientIp(request)}`, windowSec);
  if (n >= limit) throw tooMany();
}
export async function recordFail(request, bucket, windowSec) {
  await incr(`${bucket}:${clientIp(request)}`, windowSec);
}
