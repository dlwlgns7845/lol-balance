import { NextResponse } from 'next/server';
import { deleteAccount, setMainAccount, updateAccountTier } from '../../../../src/repo.js';
import { requireEditor, errStatus } from '../../../../src/auth.js';

// PATCH: { setMain: true, personId } → 본캐 지정 · { tier: {opgg_tier,...} } → 티어 갱신
export async function PATCH(request, { params }) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    await requireEditor(request, gid);
    const body = await request.json();
    if (body.setMain) await setMainAccount(params.id, body.personId);
    else if (body.tier) await updateAccountTier(params.id, body.tier);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}

export async function DELETE(request, { params }) {
  try {
    const gid = new URL(request.url).searchParams.get('gid');
    await requireEditor(request, gid);
    await deleteAccount(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: errStatus(e) });
  }
}
