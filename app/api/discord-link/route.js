// 디스코드 서버 연결 승인 (방장·편집자 또는 전역 관리자). GET=대기·승인 목록, POST=승인/거절.
import { NextResponse } from 'next/server';
import { requireEditor, errStatus } from '../../../src/auth.js';
import { listPendingLinks, getApprovedGuilds, approveGuildLink, removeGuildLink, updateGuildBrand } from '../../../src/repo.js';

// 승인 시 서버 이름·아이콘 최신화 (헤더 브랜딩용). 봇 토큰 없거나 실패해도 승인은 진행.
async function refreshBrand(guildId) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, { headers: { Authorization: `Bot ${token}` } });
    if (!r.ok) return;
    const g = await r.json();
    await updateGuildBrand(guildId, g?.name || null, g?.icon || null);
  } catch { /* 무시 */ }
}

export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    if (!gid) throw new Error('gid 필요');
    await requireEditor(request, gid);
    return NextResponse.json({ ok: true, pending: await listPendingLinks(gid), approved: await getApprovedGuilds(gid) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}

export async function POST(request) {
  try {
    const { gid, action, guildId } = await request.json();
    if (!gid || !guildId) throw new Error('gid·guildId 필요');
    await requireEditor(request, gid);
    if (action === 'approve') { await approveGuildLink(gid, guildId); await refreshBrand(guildId); }
    else if (action === 'reject') await removeGuildLink(guildId);
    else throw new Error('알 수 없는 액션');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
