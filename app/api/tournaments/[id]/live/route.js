import { NextResponse } from 'next/server';
import { drawCaptains, makeCaptain, removeCaptainTeam, assignCaptainUser, nominateNext, placeBid, sellCurrent, passCurrent, endAuction, distributeLeftover } from '../../../../../src/repo-tournament.js';
import { requireTournamentOwner, getUser, isAdmin, errStatus } from '../../../../../src/auth.js';

// 실시간 경매 동작. bid=팀장 유저 or 운영자, 나머지=운영자.
export async function POST(request, { params }) {
  try {
    const id = params.id;
    const body = await request.json();
    if (body.action === 'bid') {
      const user = await getUser(request);
      if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 });
      let owner = isAdmin(user);
      if (!owner) { try { await requireTournamentOwner(request, id); owner = true; } catch { owner = false; } }
      return NextResponse.json({ ok: true, ...(await placeBid(id, body.teamId, user, owner)) });
    }
    await requireTournamentOwner(request, id);
    let res;
    if (body.action === 'draw') res = await drawCaptains(id, body.numTeams);
    else if (body.action === 'makeCaptain') res = await makeCaptain(id, body.poolId);
    else if (body.action === 'removeCaptain') res = await removeCaptainTeam(id, body.teamId);
    else if (body.action === 'assignCaptain') res = await assignCaptainUser(id, body.teamId, body.userId);
    else if (body.action === 'nominate') res = await nominateNext(id, body.poolId);
    else if (body.action === 'sell') res = await sellCurrent(id);
    else if (body.action === 'pass') res = await passCurrent(id);
    else if (body.action === 'distribute') res = await distributeLeftover(id);
    else if (body.action === 'end') res = await endAuction(id);
    else throw new Error('알 수 없는 동작');
    return NextResponse.json({ ok: true, ...res });
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
