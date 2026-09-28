'use client';
import { useGroup } from '../../components/GroupProvider.jsx';
import { useLang } from '../../components/i18n.jsx';

export default function TournamentHome() {
  const { user, login } = useGroup() || {};
  const { t } = useLang();
  return (
    <div className="page-head"><div className="title">
      <h1>🏆 {t('멸망전')}</h1>
      <p className="sub">{t('커뮤니티 대회 포털.')}</p>
      <div className="panel center muted" style={{ padding: '40px 20px', marginTop: 16 }}>
        ← <b>{t('왼쪽에서 대회를 선택하세요.')}</b>
        {!user && <div style={{ marginTop: 10 }}><button className="btn" onClick={login}>{t('구글로 로그인')}</button> {t('하면 새 대회를 열 수 있어요.')}</div>}
      </div>
    </div></div>
  );
}
