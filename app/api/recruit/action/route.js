// 사이트→디코 관리: 강퇴/마감. 로그인 어드민만. DB 변경 후 저장된 디코 메시지를 봇토큰으로 갱신(양방향).
import { NextResponse } from 'next/server';
import { requireAdmin, errStatus } from '../../../../src/auth.js';
import { getQueue, listSignups, closeQueue, removeSignupById } from '../../../../src/repo.js';
import { syncDiscordMessage } from '../../../../src/discord-queue.js';

export async function POST(request) {
  try {
    await requireAdmin(request);
    const { queueId, action, signupId } = await request.json();
    const queue = await getQueue(queueId);
    if (!queue) throw new Error('없는 큐');
    if (action === 'close') await closeQueue(queueId);
    else if (action === 'kick' && signupId) await removeSignupById(signupId);
    else throw new Error('알 수 없는 액션');
    const fresh = await getQueue(queueId);
    const signups = await listSignups(queueId);
    const { synced } = await syncDiscordMessage(fresh, signups); // 디코 메시지도 갱신
    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
