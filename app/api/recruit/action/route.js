// 사이트→디코 관리: 강퇴/마감. 로그인 어드민만. DB 변경 후 저장된 디코 메시지를 봇토큰으로 갱신(양방향).
import { NextResponse } from 'next/server';
import { requireAdmin, errStatus } from '../../../../src/auth.js';
import { getQueue, listSignups, closeQueue, removeSignupById, listPersons, upsertSignup, setSignupMain } from '../../../../src/repo.js';
import { syncDiscordMessage, buildMetaMap } from '../../../../src/discord-queue.js';

export async function POST(request) {
  try {
    await requireAdmin(request);
    const { queueId, action, signupId, personId, main, sub } = await request.json();
    const queue = await getQueue(queueId);
    if (!queue) throw new Error('없는 큐');
    if (queue.status !== 'open' && action !== 'close') throw new Error('마감된 모집이에요');
    if (action === 'close') await closeQueue(queueId);
    else if (action === 'kick' && signupId) await removeSignupById(signupId);
    else if (action === 'move' && signupId && main) await setSignupMain(signupId, main); // 라인 이동
    else if (action === 'add') { // 사이트에서 등록 선수를 큐에 추가 (디코 연동 안 됐어도 site: 키로)
      if (!personId || !main) throw new Error('사람과 주라인을 선택하세요');
      const persons = await listPersons(queue.gid);
      const person = persons.find((p) => p.id === personId);
      if (!person) throw new Error('없는 사람');
      const discordId = person.discord_id || `site:${person.id}`;
      await upsertSignup(queueId, discordId, { name: person.nickname || person.display_name, main, sub: (main === 'all' || !sub || sub === main) ? null : sub });
    } else throw new Error('알 수 없는 액션');
    const fresh = await getQueue(queueId);
    const signups = await listSignups(queueId);
    const metaMap = buildMetaMap(await listPersons(fresh.gid));
    const { synced } = await syncDiscordMessage(fresh, signups, metaMap); // 디코 메시지도 갱신(닉·티어 포함)
    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
