// i18n — 한국어 원문을 키로 쓰고, EN일 때만 영어 사전에서 치환. 사전에 없으면 한국어 그대로(폴백) → 누락돼도 안 깨짐.
// 사전은 화면 영역별 파일로 분리 (동시 작업 충돌 방지). 새 문구 추가 시 KO 코드 + EN 사전을 같은 커밋에.
import shell from './en/shell.js';
import tournament from './en/tournament.js';
import balance from './en/balance.js';
import stats from './en/stats.js';
import people from './en/people.js';
import server from './en/server.js';
import PATTERNS from './patterns.js';

const EN = { ...server, ...people, ...stats, ...balance, ...tournament, ...shell };

export const LANGS = ['ko', 'en'];

// s: 한국어 원문(키). vars: {name} 치환값. lang==='ko'면 원문 그대로(치환만).
export function translate(lang, s, vars) {
  if (s == null || typeof s !== 'string') return s;
  let out = s;
  if (lang === 'en') {
    const hit = EN[s];
    if (hit != null) out = hit;
    else {
      // 서버에서 값이 섞여 오는 동적 메시지(에러 등) — 정규식 패턴으로 치환
      for (const [re, fn] of PATTERNS) {
        const m = s.match(re);
        if (m) { out = fn(...m.slice(1)); break; }
      }
    }
  }
  if (vars) out = out.replace(/\{(\w+)\}/g, (all, k) => (vars[k] != null ? String(vars[k]) : all));
  return out;
}

// 개발 점검용: EN 사전 키 개수
export const EN_SIZE = Object.keys(EN).length;
