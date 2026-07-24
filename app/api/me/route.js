// 로그인=본인선수 자동매칭. GET=내 선수 조회, POST=디코계정↔선수 연결(사이트에서 하는 /연동).
import { NextResponse } from 'next/server';
import { getUser, discordIdOf } from '../../../src/auth.js';
import { findPersonByDiscord, linkPersonToDiscord, unlinkPersonDiscord } from '../../../src/repo.js';

export async function GET(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    const user = await getUser(request);
    if (!user) return NextResponse.json({ ok: true, loggedIn: false });
    const discordId = discordIdOf(user);
    let person = null;
    if (gid && discordId) person = await findPersonByDiscord(gid, discordId);
    return NextResponse.json({
      ok: true, loggedIn: true, hasDiscord: !!discordId,
      person: person ? { id: person.id, name: person.nickname || person.display_name } : null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { gid, personId } = await request.json();
    const user = await getUser(request);
    if (!user) { const e = new Error('로그인이 필요해요.'); e.status = 401; throw e; }
    const discordId = discordIdOf(user);
    if (!discordId) { const e = new Error('디스코드로 로그인해야 선수를 연결할 수 있어요.'); e.status = 400; throw e; }
    if (!gid || !personId) throw new Error('gid·personId 필요');
    await linkPersonToDiscord(gid, personId, discordId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 500 });
  }
}

// 본인 연동 해제 — 내 디코계정에 연결된 선수의 discord_id만 null (기록 보존)
export async function DELETE(request) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    const user = await getUser(request);
    if (!user) { const e = new Error('로그인이 필요해요.'); e.status = 401; throw e; }
    const discordId = discordIdOf(user);
    if (!gid || !discordId) throw new Error('gid 필요');
    const person = await findPersonByDiscord(gid, discordId);
    if (person) await unlinkPersonDiscord(gid, person.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 500 });
  }
}
