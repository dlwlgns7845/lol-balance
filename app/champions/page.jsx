'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useGroup } from '../../components/GroupProvider.jsx';
import { useDdragon } from '../../components/ddragon.js';
import ChampImg from '../../components/ChampImg.jsx';
import WinLossBar from '../../components/WinLossBar.jsx';
import Avatar from '../../components/Avatar.jsx';
import { TIER_LABEL, tierClass } from '../../src/table.js';
import { useLang } from '../../components/i18n.jsx';

const wrCls = (w) => (w >= 0.6 ? 'green' : w >= 0.5 ? 'yellow' : 'red');
const kdaCls = (r) => (r >= 5 ? 'kv-5' : r >= 4 ? 'kv-4' : r >= 3 ? 'kv-3' : '');
const LANE_KR = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', sup: '서폿' };

export default function ChampionsPage() {
  const { group } = useGroup();
  const gid = group?.id;
  const dd = useDdragon();
  const { t } = useLang();
  const sp = useSearchParams();
  const id = sp.get('id');
  const [players, setPlayers] = useState([]);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (!gid) return;
    fetch('/api/stats?gid=' + gid).then((x) => x.json()).then((r) => r.ok && setPlayers(r.players));
  }, [gid]);

  useEffect(() => {
    if (!gid || !id) { setDetail(null); return; }
    setDetail(null);
    fetch(`/api/player/${id}?gid=${gid}`).then((x) => x.json()).then((r) => r.ok && setDetail(r));
  }, [gid, id]);

  const p = players.find((x) => x.id === id);
  const champs = detail?.champions || [];

  return (
    <div>
      <div className="page-head">
        <div className="title">
          <h1>{t('모스트 챔피언')}{p ? ` · ${p.nickname || p.name}` : ''}</h1>
          <p className="sub" style={{ margin: 0 }}>{t('이 선수가 플레이한 모든 챔피언 상세 · 딜/CS/골드(분당)·시야·멀티킬 (판수순).')}</p>
        </div>
        {p && <Link href={`/player?id=${p.id}`} className="btn ghost">{t('← 전적으로')}</Link>}
      </div>

      {!p ? (
        <div className="panel center muted" style={{ padding: '28px 0' }}>{t('선수를 찾을 수 없어요.')} <Link href="/player" className="accent">{t('전적')}</Link>{t('에서 선택하세요.')}</div>
      ) : !detail ? (
        <div className="panel center muted" style={{ padding: '28px 0' }}>{t('불러오는 중…')}</div>
      ) : (
        <>
          <div className="panel prof-top">
            <div className="prof-name">
              <span className="prof-av" style={{ background: 'none', padding: 0 }}><Avatar name={p.nickname || p.name} profile={p.profile} size={48} /></span>
              <div>
                <div className="prof-nm">{p.nickname || p.name}</div>
                <div className="prof-sub"><span className={tierClass(p.base_tier)}>{t(TIER_LABEL[p.base_tier])}</span> · {t('{n}챔피언', { n: champs.length })} · {t('{n}게임', { n: p.games })}</div>
              </div>
            </div>
          </div>

          {detail?.laneMatchups?.length > 0 && (
            <div className="panel">
              <h2>{t('맞라인 상대')} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· {t('같은 라인 만났을 때 승률')}</span></h2>
              <div className="lane-list">
                {detail.laneMatchups.slice(0, 8).map((o) => (
                  <div className="lane-row" key={o.name + o.pos}>
                    <span className="lane-pos muted">{t(LANE_KR[o.pos]) || '-'}</span>
                    <span className="lane-nm">{o.name}</span>
                    <span className="muted lane-g">{t('{n}판', { n: o.games })}</span>
                    <WinLossBar wins={o.wins} losses={o.games - o.wins} showText />
                    <span className={`pcc-wr ${wrCls(o.winrate)}`}>{Math.round(o.winrate * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="rec-history champ-table">
                <thead><tr>
                  <th className="l">{t('챔피언')}</th><th>{t('게임')}</th><th>{t('승률')}</th><th>KDA</th><th className="l">{t('평균 K/D/A')}</th>
                  <th>{t('딜')} <span className="muted">({t('분당')})</span></th><th>CS <span className="muted">({t('분당')})</span></th><th>{t('골드')} <span className="muted">({t('분당')})</span></th><th>{t('시야')}</th><th>{t('멀티킬')}</th>
                </tr></thead>
                <tbody>
                  {champs.map((c, i) => (
                    <tr key={c.champion}>
                      <td className="l"><span className="rh-champ"><span className="ch-rank muted">{i + 1}</span><ChampImg name={c.champion} iconUrl={dd.icon} size={30} /><b>{dd.label(c.champion)}</b></span></td>
                      <td className="ct-games">{t('{n}판', { n: c.games })}</td>
                      <td><div className="wr-cell"><b className={wrCls(c.winrate)}>{Math.round(c.winrate * 100)}%</b><WinLossBar wins={c.wins} losses={c.games - c.wins} width={110} showText /></div></td>
                      <td className={kdaCls(c.kda)}><b>{c.kda}</b></td>
                      <td className="l muted">{c.avgK} / <span className="red">{c.avgD}</span> / {c.avgA}</td>
                      <td>{c.hasDetail ? <><b>{(c.avgDmg || 0).toLocaleString()}</b> <span className="muted">({c.dmgPerMin})</span></> : <span className="muted">-</span>}</td>
                      <td>{c.hasDetail ? <><b>{c.avgCs}</b> <span className="muted">({c.csPerMin})</span></> : <span className="muted">-</span>}</td>
                      <td>{c.hasDetail ? <><b>{(c.avgGold || 0).toLocaleString()}</b> <span className="muted">({c.goldPerMin})</span></> : <span className="muted">-</span>}</td>
                      <td className="muted">{c.hasDetail ? <>{c.avgVision} <span style={{ fontSize: 10.5 }}>👁{c.avgWards}</span></> : '-'}</td>
                      <td>{c.multikills ? <b className="gold">{c.multikills}{c.pentas ? ` · P${c.pentas}` : ''}</b> : <span className="muted">-</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
