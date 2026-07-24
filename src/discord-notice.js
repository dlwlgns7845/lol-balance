// 멸망전 → 디코 채널 자동공지. 봇 토큰으로 채널에 임베드 POST.
// 안전: 승인+대회연결+채널설정 3겹 통과한 (서버,채널)에만. best-effort(실패해도 대회진행 안 막음).
import { db } from './supabase.js';

// 이 대회에 연결된 공지 대상 (서버,채널). repo-tournament 순환 import 피하려 여기서 직접 조회.
async function targetsFor(tournamentId) {
  if (!tournamentId) return [];
  try {
    const { data, error } = await db().from('discord_guilds')
      .select('guild_id, notice_channel_id').eq('tournament_id', tournamentId).eq('status', 'approved');
    if (error) return [];
    return (data || []).filter((g) => g.notice_channel_id).map((g) => ({ channelId: g.notice_channel_id }));
  } catch { return []; }
}

async function postToChannel(channelId, payload) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !channelId) return false;
  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
    });
    return r.ok;
  } catch { return false; }
}

// 이 대회에 연결된 모든 공지채널에 임베드 발송. 반환=성공 채널 수. 절대 throw 안 함(best-effort).
export async function postTournamentNotice(tournamentId, embed) {
  try {
    const targets = await targetsFor(tournamentId);
    if (!targets.length) return 0;
    let ok = 0;
    for (const t of targets) { if (await postToChannel(t.channelId, { embeds: [embed] })) ok++; }
    return ok;
  } catch { return 0; }
}

const COLOR = { info: 0x5865F2, win: 0x3fa66f, bracket: 0xc8942f };
export function noticeEmbed(title, description, opts = {}) {
  const e = { title, color: opts.color ?? COLOR.info };
  if (description) e.description = description;
  if (opts.fields) e.fields = opts.fields;
  if (opts.footer) e.footer = { text: opts.footer };
  return e;
}
export { COLOR };
