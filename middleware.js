import { NextResponse } from 'next/server';

// 🔒 사이트 닫기 스위치. true = 모든 페이지가 "서비스 종료" 화면.
//    다시 열려면 false 로 바꿔서 push. (봇 /api/* 는 영향 없음)
const MAINTENANCE = true;

const PAGE = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>서비스 종료</title>
<style>
  :root{color-scheme:dark}
  *{margin:0;box-sizing:border-box}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0d0e12;color:#e6e8ee;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;text-align:center}
  .box{max-width:440px}
  .ic{font-size:52px;line-height:1;margin-bottom:18px}
  h1{font-size:24px;font-weight:800;letter-spacing:-.01em;margin-bottom:12px}
  p{font-size:14.5px;line-height:1.7;color:#9aa0ad}
  .accent{color:#4fb6d6;font-weight:700}
</style></head>
<body><div class="box">
  <div class="ic">🔒</div>
  <h1>서비스 종료 안내</h1>
  <p><span class="accent">내전 밸런스</span> 서비스를 잠시 닫았습니다.<br>이용해 주셔서 감사합니다.</p>
</div></body></html>`;

export function middleware() {
  if (!MAINTENANCE) return NextResponse.next();
  return new NextResponse(PAGE, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// 페이지 라우트만 차단. api(봇)·정적자원·favicon·로고는 통과.
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|logo.webp).*)'],
};
