'use client';
import { useGroup } from '../../components/GroupProvider.jsx';

export default function TournamentHome() {
  const { user, login } = useGroup() || {};
  return (
    <div className="page-head"><div className="title">
      <h1>🏆 멸망전</h1>
      <p className="sub">커뮤니티 대회 포털.</p>
      <div className="panel center muted" style={{ padding: '40px 20px', marginTop: 16 }}>
        ← 왼쪽에서 <b>대회를 선택</b>하세요.
        {!user && <div style={{ marginTop: 10 }}><button className="btn" onClick={login}>구글로 로그인</button> 하면 새 대회를 열 수 있어요.</div>}
      </div>
    </div></div>
  );
}
