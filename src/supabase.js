// Supabase 서버 클라이언트 (service_role 키 — 서버 전용, 브라우저에 노출 금지).
import { createClient } from '@supabase/supabase-js';

let client = null;

export function db() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다 — .env.local 확인');
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
