'use client';
// 브라우저용 Supabase 클라이언트 — 오직 인증(구글 로그인)용. anon key는 공개돼도 안전.
// 데이터 접근은 여전히 서버(service_role)만. 이 키가 없으면 인증 비활성(레거시 오픈 모드).
import { createClient } from '@supabase/supabase-js';

let _client = null;
let _tried = false;

export function supabaseBrowser() {
  if (_tried) return _client;
  _tried = true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return _client;
}

export function authConfigured() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
