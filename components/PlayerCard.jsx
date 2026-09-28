'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TIER_LABEL } from '../src/table.js';
import Radar from './Radar.jsx';
import ChampImg from './ChampImg.jsx';
import PositionBar from './PositionBar.jsx';
import WinLossBar from './WinLossBar.jsx';
import Avatar from './Avatar.jsx';
import { useLang } from './i18n.jsx';

const LANE_KR = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', sup: '서폿' };
function wrClass(w) { return w >= 0.6 ? 'green' : w >= 0.5 ? 'yellow' : 'red'; }
function kdaClass(r) { return r >= 5 ? 'kv-5' : r >= 4 ? 'kv-4' : r >= 3 ? 'kv-3' : ''; }
function fmtD(s) { if (!s) return ''; const d = new Date(s); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

export default function PlayerCard({ player: p, gid, max, dd, onClose, detail: detailProp, historyLabel = '내전 전적', showDetailLinks = true, onDetail }) {
  const { t } = useLang();
  const [detailState, setDetail] = useState(null);
  const detail = detailProp || detailState; // detail을 직접 주면(멸망전 등) fetch 안 함
  useEffect(() => {
    if (detailProp || !gid || !p) return;
    setDetail(null);
    fetch(`/api/player/${p.id}?gid=${gid}`).then((x) => x.json()).then((r) => r.ok && setDetail(r));
  }, [gid, p, detailProp]);

  const hero = dd.splash(p.topChamps?.[0]?.champion);
  const radar = [
    { label: t('승률'), value: p.winrate },
    { label: 'KDA', value: (p.kda || 0) / max.kda },
    { label: t('딜량'), value: (p.avgDamage || 0) / max.dmg },
    { label: 'CS', value: (p.avgCs || 0) / max.cs },
    { label: t('챔프폭'), value: (p.champPool || 0) / max.pool },
  ];
  const kpi = (label, val, cls) => <div><span className="muted">{label}</span><b className={cls || ''}>{val}</b></div>;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="pcard" onClick={(e) => e.stopPropagation()}>
        <button className="pcard-x" onClick={onClose}>✕</button>
        <div className="pcard-hero" style={hero ? { backgroundImage: `linear-gradient(90deg, var(--panel) 20%, rgba(16,16,25,.55) 50%, transparent 74%), radial-gradient(ellipse 78% 135% at 80% 42%, transparent 38%, var(--panel) 86%), url(${hero})` } : {}}>
          <div className="ph-id">
            <div className="pc-avatar" style={{ background: 'none', padding: 0 }}><Avatar name={p.nickname || p.name} profile={p.profile} size={50} /></div>
            <div>
              <div className="pc-name">{p.nickname || p.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{p.nickname ? p.name + ' · ' : ''}{t(TIER_LABEL[p.base_tier])} · {t('{n}게임', { n: p.games })}</div>
              <div className="ph-tags">
                <span className={`ph-tag ${kdaClass(p.kda || 0)}`}>KDA {p.kda != null ? p.kda.toFixed(2) : '-'}</span>
                <span className={`ph-tag ${wrClass(p.winrate)}`}>{t('승률')} {Math.round(p.winrate * 100)}%</span>
                <span className="ph-tag"><b className="green">{p.wins}</b>{t('승')} <b className="red">{p.losses}</b>{t('패')}</span>
                {onDetail && <button className="ph-tag" onClick={onDetail} style={{ cursor: 'pointer', background: 'rgba(79,182,214,.18)', border: '1px solid rgba(79,182,214,.45)', color: '#8fd6ec', fontWeight: 700 }}>📄 {t('상세보기 →')}</button>}
              </div>
            </div>
          </div>
        </div>

        <div className="pcard-body">
          <div className="pc-col">
            <h3>{t('기본 스탯')}</h3>
            <div className="pc-kpis">
              {kpi(t('게임 수'), p.games)}
              {kpi('KDA', p.kda != null ? p.kda.toFixed(2) : '-', kdaClass(p.kda || 0))}
              {kpi('🏅 MVP', p.mvp, 'gold')}
              {kpi('⭐ ACE', p.ace, 'accent')}
              {kpi(t('평균 딜량'), p.statGames ? p.avgDamage.toLocaleString() : '-')}
              {kpi(t('평균 CS'), p.statGames ? p.avgCs.toLocaleString() : '-')}
              {kpi(t('총 K/D/A'), p.statGames ? `${(p.totalK || 0).toLocaleString()} / ${(p.totalD || 0).toLocaleString()} / ${(p.totalA || 0).toLocaleString()}` : '-')}
            </div>
            {p.positions && (
              <>
                <h3 style={{ marginTop: 16 }}>{t('포지션')}</h3>
                <PositionBar positions={p.positions} stats={p.positionStats} />
              </>
            )}
            <h3 style={{ marginTop: 16 }}>{t('능력치')}</h3>
            <Radar metrics={radar} size={220} />
          </div>

          <div className="pc-col">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('모스트 챔피언')}
              {showDetailLinks && detail?.champions?.length > 5 && <Link href={`/champions?id=${p.id}`} onClick={onClose} className="accent" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600 }}>{t('상세보기 →')}</Link>}
            </h3>
            <div className="pc-champs">
              {detail ? (detail.champions.length ? detail.champions.slice(0, 5).map((c) => (
                <div className="pc-champ" key={c.champion}>
                  <ChampImg name={c.champion} iconUrl={dd.icon} size={32} />
                  <div className="pcc-info">
                    <span className="pcc-name">{dd.label(c.champion)}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{t('{n}판', { n: c.games })} · KDA {c.kda} · {c.k}/<span className="red">{c.d}</span>/{c.a}</span>
                  </div>
                  <WinLossBar wins={c.wins} losses={c.games - c.wins} showText />
                  <span className={`pcc-wr ${wrClass(c.winrate)}`}>{Math.round(c.winrate * 100)}%</span>
                </div>
              )) : <span className="muted">{t('기록 없음')}</span>) : <span className="muted">…</span>}
            </div>

            <div className="pc-duos">
              <div>
                <h3>{t('베스트 듀오')}</h3>
                {detail?.best?.length ? detail.best.map((d) => (
                  <div className="duo-row" key={d.name}><span>{d.name}</span><span className="muted">{t('{n}게임', { n: d.games })}</span><b className={wrClass(d.winrate)}>{Math.round(d.winrate * 100)}%</b></div>
                )) : <span className="muted">-</span>}
              </div>
              <div>
                <h3>{t('워스트 듀오')}</h3>
                {detail?.worst?.length ? detail.worst.map((d) => (
                  <div className="duo-row" key={d.name}><span>{d.name}</span><span className="muted">{t('{n}게임', { n: d.games })}</span><b className={wrClass(d.winrate)}>{Math.round(d.winrate * 100)}%</b></div>
                )) : <span className="muted">-</span>}
              </div>
            </div>

            {detail?.laneMatchups?.length > 0 && (
              <>
                <h3 style={{ marginTop: 14 }}>{t('맞라인 상대')} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· {t('같은 라인 승률')}</span></h3>
                {detail.laneMatchups.slice(0, 5).map((o) => (
                  <div className="duo-row" key={o.name + o.pos}><span>{t(LANE_KR[o.pos] || '')} {o.name}</span><span className="muted">{t('{n}게임', { n: o.games })}</span><b className={wrClass(o.winrate)}>{Math.round(o.winrate * 100)}%</b></div>
                ))}
              </>
            )}

            <h3 style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              {t(historyLabel)} {detail?.history ? <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{t('{n}게임', { n: detail.history.length })}</span> : null}
              {onDetail ? <button onClick={onDetail} className="accent" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{t('상세보기 →')}</button> : (showDetailLinks && <Link href={`/player?id=${p.id}`} onClick={onClose} className="accent" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600 }}>{t('상세보기 →')}</Link>)}
            </h3>
            <div className="pc-history no-scroll">
              {detail ? (detail.history.length ? detail.history.slice(0, 5).map((m, i) => {
                const ratio = (m.d ? (((m.k || 0) + (m.a || 0)) / m.d) : ((m.k || 0) + (m.a || 0))).toFixed(2);
                return (
                  <div key={i} className={`pch-row ${m.win ? 'win' : 'lose'}`}>
                    <span className={`pch-res ${m.win ? 'g' : 'r'}`}>{m.win ? t('승') : t('패')}</span>
                    <ChampImg name={m.champion} iconUrl={dd.icon} size={30} />
                    <div className="pch-mid">
                      <span className="pch-champ">{dd.label(m.champion) || '?'}</span>
                      <span className="pch-kda">{m.k}/<span className="red">{m.d}</span>/{m.a} <span className={`pch-ratio ${kdaClass(+ratio)}`}>{ratio}</span></span>
                    </div>
                    <span className="pch-date muted">{fmtD(m.played_at)}</span>
                  </div>
                );
              }) : <span className="muted">{t('기록 없음')}</span>) : <span className="muted">…</span>}
            </div>
            {detail?.history?.length > 5 && (
              <div className="pc-more-note muted">{t('최근 5게임만 표시 · 위')} <b>{t('상세보기')}</b>{t('에서 전체 {n}게임', { n: detail.history.length })}</div>
            )}

            {detail?.records && (detail.records.maxKill || detail.records.maxKda) && (
              <div className="pc-records">
                {detail.records.maxKill && <span>🗡 {t('최다 킬')} <b>{detail.records.maxKill.kills}</b> <span className="muted">{dd.label(detail.records.maxKill.champion)}</span></span>}
                {detail.records.maxKda && <span>📈 {t('최고 KDA')} <b>{detail.records.maxKda.v}</b> <span className="muted">{dd.label(detail.records.maxKda.champion)}</span></span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
