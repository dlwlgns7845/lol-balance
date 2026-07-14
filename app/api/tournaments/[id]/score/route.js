import { NextResponse } from 'next/server';
import { submitScoreTeam, createScoreTeam, requestJoinScoreTeam, cancelJoinRequest, resolveJoinRequest, kickScoreMember, submitScoreTeamReady, disbandScoreTeam, tournamentRole } from '../../../../../src/repo-tournament.js';
import { getUser, isAdmin, errStatus } from '../../../../../src/auth.js';

// 점수제 팀 — 방장 승인제(합류 신청 → 방장 수락). 로그인 필요.
// action: create(방장 팀 생성) · request(합류 신청) · cancel(신청 취소) ·
//         resolve(수락/거절, 방장/운영자) · kick(내보내기) · submit(팀 확정) · disband(해체) ·
//         assemble(운영자 직접 조립 — 시뮬 툴에서 관리자만)
export async function POST(request, { params }) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 });
    const body = await request.json();
    const id = params.id;
    const role = await tournamentRole(id, user.id);
    const manager = isAdmin(user) || role === 'owner' || role === 'admin';
    const ok = (data) => NextResponse.json({ ok: true, ...data });
    switch (body.action) {
      case 'create': return ok(await createScoreTeam(id, user, body));
      case 'request': return ok(await requestJoinScoreTeam(id, user, body));
      case 'cancel': return ok(await cancelJoinRequest(id, user, body));
      case 'resolve': return ok(await resolveJoinRequest(id, user, manager, body));
      case 'kick': return ok(await kickScoreMember(id, user, manager, body));
      case 'submit': return ok(await submitScoreTeamReady(id, user, manager, body));
      case 'disband': return ok(await disbandScoreTeam(id, user, manager, body));
      case 'assemble':
        if (!manager) return NextResponse.json({ ok: false, error: '운영자만 직접 조립할 수 있어요' }, { status: 403 });
        return ok(await submitScoreTeam(id, body));
      default: return NextResponse.json({ ok: false, error: '알 수 없는 동작' }, { status: 400 });
    }
  } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) }); }
}
