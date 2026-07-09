'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useGroup } from '../../components/GroupProvider.jsx';
import { useDdragon } from '../../components/ddragon.js';
import ChampImg from '../../components/ChampImg.jsx';
import PositionBar from '../../components/PositionBar.jsx';
import WinLossBar from '../../components/WinLossBar.jsx';
import Avatar from '../../components/Avatar.jsx';
import Radar from '../../components/Radar.jsx';
import { TIER_LABEL } from '../../src/table.js';

const wrCls = (w) => (w >= 0.6 ? 'green' : w >= 0.5 ? 'yellow' : 'red');
const kdaCls = (r) => (r >= 5 ? 'kv-5' : r >= 4 ? 'kv-4' : r >= 3 ? 'kv-3' : '');
const fmtD = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const posKr = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', sup: '서폿' };

export default function PlayerRecordPage() {
  const { group } = useGroup();
  const gid = group?.id;
  const dd = useDdragon();
  const sp = useSearchParams();
  const router = useRouter();
  const [players, setPlayers] = useState([]);
  const sel = sp.get('id') || '';
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [detail, setDetail] = useState(null);

  function pick(id) {
    setQ('');
    setFocus(false);
    router.replace('/player?id=' + id);
  }

  useEffect(() => {
    if (!gid) return;
    fetch('/api/stats?gid=' + gid).then((x) => x.json()).then((r) => {
      if (r.ok) setPlayers(r.players || []);
    });
  }, [gid]);

  useEffect(() => {
    if (!gid || !sel) {
      setDetail(null);
      return;
    }
    setDetail(null);
    fetch(`/api/player/${sel}?gid=${gid}`).then((x) => x.json()).then((r) => r.ok && setDetail(r));
  }, [gid, sel]);

  const p = players.find((x) => x.id === sel);
  const played = players.filter((x) => x.games > 0).slice().sort((a, b) => b.games - a.games);
  const qn = q.trim().toLowerCase();
  const hits = qn ? played.filter((x) => (x.nickname || x.name || '').toLowerCase().includes(qn)) : played;
  const hero = p ? dd.splash(p.topChamps?.[0]?.champion) : null;
  const max = useMemo(() => ({
    kda: Math.max(1, ...played.map((x) => x.kda || 0)),
    dmg: Math.max(1, ...played.map((x) => x.avgDamage || 0)),
    cs: Math.max(1, ...played.map((x) => x.avgCs || 0)),
    pool: Math.max(1, ...played.map((x) => x.champPool || 0)),
  }), [played]);
  const radar = p ? [
    { label: '승률', value: p.winrate || 0 },
    { label: 'KDA', value: (p.kda || 0) / max.kda },
    { label: '딜량', value: (p.avgDamage || 0) / max.dmg },
    { label: 'CS', value: (p.avgCs || 0) / max.cs },
    { label: '챔프폭', value: (p.champPool || 0) / max.pool },
  ] : [];

  const kpi = (label, val, cls) => (
    <div className="pr-kpi">
      <span>{label}</span>
      <b className={cls || ''}>{val}</b>
    </div>
  );

  return (
    <div className="stats-pink player-record">
      <div className="page-head pr-head">
        <div className="title">
          <h1>전적</h1>
          <p className="sub" style={{ margin: 0 }}>선수 이름을 검색해서 개인 전적을 확인하세요.</p>
        </div>
        <div className="psearch">
          <input
            placeholder="선수 이름 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => setTimeout(() => setFocus(false), 150)}
          />
          {focus && (
            <div className="psearch-list">
              {hits.slice(0, 10).map((x) => (
                <button key={x.id} className={`psearch-item ${x.id === sel ? 'on' : ''}`} onMouseDown={() => pick(x.id)} type="button">
                  <span className="pi-av" style={{ background: 'none', padding: 0 }}><Avatar name={x.nickname || x.name} profile={x.profile} size={22} /></span>
                  <span className="pi-nm">{x.nickname || x.name}</span>
                  <span className="muted pi-meta">{TIER_LABEL[x.base_tier]}</span>
                </button>
              ))}
              {hits.length === 0 && <div className="muted psearch-none">검색 결과 없음</div>}
            </div>
          )}
        </div>
      </div>

      {!p ? (
        <div className="panel center muted" style={{ padding: '28px 0' }}>위 검색창에서 선수를 검색하세요.</div>
      ) : (
        <div className="pr-shell">
          <section className="pr-hero" style={hero ? { backgroundImage: `linear-gradient(90deg, rgba(15,11,18,.98) 0%, rgba(15,11,18,.86) 44%, rgba(15,11,18,.24) 72%), url(${hero})` } : undefined}>
            <div className="pr-id">
              <div className="pr-avatar"><Avatar name={p.nickname || p.name} profile={p.profile} size={58} /></div>
              <div>
                <h2>{p.nickname || p.name}</h2>
                <p>{p.nickname ? p.name + ' · ' : ''}{TIER_LABEL[p.base_tier]} · {p.games}게임</p>
                <div className="pr-tags">
                  <span className={`pr-tag ${kdaCls(p.kda || 0)}`}>KDA {p.kda != null ? p.kda.toFixed(2) : '-'}</span>
                  <span className={`pr-tag ${wrCls(p.winrate)}`}>{p.wins}승 {p.losses}패</span>
                  <span className="pr-tag">{Math.round((p.winrate || 0) * 100)}%</span>
                </div>
              </div>
            </div>
          </section>

          <div className="pr-grid">
            <section className="pr-left">
              <div className="pr-section">
                <h3>기본 스탯</h3>
                <div className="pr-kpis">
                  {kpi('게임 수', p.games)}
                  {kpi('KDA', p.kda != null ? p.kda.toFixed(2) : '-', kdaCls(p.kda || 0))}
                  {kpi('MVP', p.mvp, 'gold')}
                  {kpi('ACE', p.ace, 'accent')}
                  {kpi('평균 딜량', p.statGames ? p.avgDamage.toLocaleString() : '-')}
                  {kpi('평균 CS', p.statGames ? p.avgCs.toLocaleString() : '-')}
                  {kpi('총 K/D/A', p.statGames ? `${(p.totalK || 0).toLocaleString()} / ${(p.totalD || 0).toLocaleString()} / ${(p.totalA || 0).toLocaleString()}` : '-')}
                </div>
              </div>

              {p.positions && Object.values(p.positions).some((n) => n > 0) && (
                <div className="pr-section">
                  <h3>포지션 <span>{p.mainPos ? `주 라인 ${posKr[p.mainPos]}` : ''}</span></h3>
                  <PositionBar positions={p.positions} stats={p.positionStats} />
                </div>
              )}

              <div className="pr-section">
                <h3>능력치</h3>
                <Radar metrics={radar} size={230} color="#a98cff" />
              </div>
            </section>

            <section className="pr-right">
              <div className="pr-section">
                <h3>
                  모스트 챔피언
                  {detail?.champions?.length > 5 && <Link href={`/champions?id=${p.id}`} className="accent">상세보기 →</Link>}
                </h3>
                <div className="pc-champs">
                  {detail ? (detail.champions.length ? detail.champions.slice(0, 5).map((c) => (
                    <div className="pc-champ pr-champ" key={c.champion}>
                      <ChampImg name={c.champion} iconUrl={dd.icon} size={34} />
                      <div className="pcc-info">
                        <span className="pcc-name">{c.champion}</span>
                        <span className="muted" style={{ fontSize: 11 }}>{c.games}판 · KDA {c.kda} · {c.k}/<span className="red">{c.d}</span>/{c.a}</span>
                      </div>
                      <WinLossBar wins={c.wins} losses={c.games - c.wins} showText />
                      <span className={`pcc-wr ${wrCls(c.winrate)}`}>{Math.round(c.winrate * 100)}%</span>
                    </div>
                  )) : <span className="muted">기록 없음</span>) : <span className="muted">불러오는 중...</span>}
                </div>
              </div>

              <div className="pr-duos">
                <div className="pr-section">
                  <h3>베스트 듀오</h3>
                  {detail?.best?.length ? detail.best.slice(0, 3).map((d) => (
                    <div className="duo-row" key={d.name}><span>{d.name}</span><span className="muted">{d.games}게임</span><b className={wrCls(d.winrate)}>{Math.round(d.winrate * 100)}%</b></div>
                  )) : <span className="muted">-</span>}
                </div>
                <div className="pr-section">
                  <h3>워스트 듀오</h3>
                  {detail?.worst?.length ? detail.worst.slice(0, 3).map((d) => (
                    <div className="duo-row" key={d.name}><span>{d.name}</span><span className="muted">{d.games}게임</span><b className={wrCls(d.winrate)}>{Math.round(d.winrate * 100)}%</b></div>
                  )) : <span className="muted">-</span>}
                </div>
              </div>

              <div className="pr-section">
                <h3>내전 전적 <span>{detail?.history ? `${detail.history.length}게임` : ''}</span></h3>
                <div className="pc-history no-scroll">
                  {detail ? (detail.history.length ? detail.history.slice(0, 5).map((m, i) => {
                    const ratio = (m.d ? (((m.k || 0) + (m.a || 0)) / m.d) : ((m.k || 0) + (m.a || 0))).toFixed(2);
                    return (
                      <div key={i} className={`pch-row ${m.win ? 'win' : 'lose'}`}>
                        <span className={`pch-res ${m.win ? 'g' : 'r'}`}>{m.win ? '승' : '패'}</span>
                        <ChampImg name={m.champion} iconUrl={dd.icon} size={32} />
                        <div className="pch-mid">
                          <span className="pch-champ">{m.champion || '?'}</span>
                          <span className="pch-kda">{m.k}/<span className="red">{m.d}</span>/{m.a} <span className={`pch-ratio ${kdaCls(+ratio)}`}>{ratio}</span></span>
                        </div>
                        <span className="pch-date muted">{fmtD(m.played_at)}</span>
                      </div>
                    );
                  }) : <span className="muted">기록 없음</span>) : <span className="muted">불러오는 중...</span>}
                </div>
                {detail?.history?.length > 5 && <div className="pc-more-note muted">최근 5게임만 표시</div>}
              </div>

              {detail?.records && (detail.records.maxKill || detail.records.maxKda) && (
                <div className="pr-records">
                  {detail.records.maxKill && <span>최다 킬 <b>{detail.records.maxKill.kills}</b> <em>{detail.records.maxKill.champion}</em></span>}
                  {detail.records.maxKda && <span>최고 KDA <b>{detail.records.maxKda.v}</b> <em>{detail.records.maxKda.champion}</em></span>}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
