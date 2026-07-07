'use client';
// 모든 쓰기 API 호출에 로그인 토큰(Authorization: Bearer)을 자동으로 붙여준다.
// 비로그인이면 헤더 없이 그냥 요청(서버가 권한 판단). 읽기 호출도 써도 무방.
import { supabaseBrowser } from '../src/supabase-browser.js';

export async function apiFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  try {
    const sb = supabaseBrowser();
    if (sb) {
      const { data } = await sb.auth.getSession();
      const t = data?.session?.access_token;
      if (t) headers.Authorization = 'Bearer ' + t;
    }
  } catch { /* 인증 미설정 → 그냥 진행 */ }
  return fetch(url, { ...opts, headers });
}
