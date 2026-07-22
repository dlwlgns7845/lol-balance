import { NextResponse } from 'next/server';
import { getRoomGuildBrand } from '../../../src/repo.js';

// 방에 연결된 디코 서버의 이름·아이콘 (헤더 브랜딩용). 공개 정보라 인증 불필요.
export async function GET(req) {
  const gid = new URL(req.url).searchParams.get('gid');
  if (!gid) return NextResponse.json({ ok: false, error: 'gid required' }, { status: 400 });
  try {
    const g = await getRoomGuildBrand(gid);
    if (!g) return NextResponse.json({ ok: true, brand: null });
    return NextResponse.json({
      ok: true,
      brand: {
        name: g.guild_name || null,
        icon: g.guild_icon ? `https://cdn.discordapp.com/icons/${g.guild_id}/${g.guild_icon}.png?size=128` : null,
      },
    });
  } catch {
    return NextResponse.json({ ok: true, brand: null });
  }
}
