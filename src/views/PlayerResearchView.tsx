import { ArrowLeft, ArrowLeftRight, Bookmark, BookmarkCheck, Info, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { AssetReturnHealthBundle, ForwardHorizonDays } from '../asset-returns'
import { AssetResearchPanel } from '../components/AssetResearchPanel'
import { AssetBadge, formatValue } from '../components/domain-ui'
import type { LeagueContext } from '../league-context'
import type { PlayerResearchProfile } from '../player-research'

function sourceValue(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Unavailable' : formatValue(value)
}

function dateLabel(value: string): string {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Timestamp unavailable'
}

export function PlayerResearchView({
  profile,
  leagueContext,
  assetReturnHealth,
  horizonYears,
  watchlisted,
  onBack,
  onToggleWatchlist,
  onOpenTrade,
}: {
  profile: PlayerResearchProfile
  leagueContext: LeagueContext
  assetReturnHealth: AssetReturnHealthBundle | null
  horizonYears: number
  watchlisted: boolean
  onBack: () => void
  onToggleWatchlist: () => void
  onOpenTrade: () => void
}) {
  const [holdingPeriodDays, setHoldingPeriodDays] = useState<ForwardHorizonDays>(horizonYears >= 3 ? 365 : horizonYears === 2 ? 180 : 30)
  const { asset, owner, projection } = profile
  return (
    <main className="page-shell player-research-page">
      <section className="player-research-hero panel">
        <div className="player-research-breadcrumb"><button type="button" onClick={onBack}><ArrowLeft size={16} /> Back to Home</button><span>{leagueContext.label} · {leagueContext.labels.format}</span></div>
        <div className="player-research-identity">
          <AssetBadge position={asset.position} />
          <div><span className="eyebrow">Player research</span><h1>{asset.name}</h1><p>{asset.team ?? 'NFL team unavailable'} · {asset.position} · {asset.age === null ? 'Age unavailable' : `Age ${asset.age.toFixed(1)}`}</p></div>
          <div className="player-research-actions">
            <button type="button" className={watchlisted ? 'active' : ''} onClick={onToggleWatchlist}>{watchlisted ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}{watchlisted ? 'Watching' : 'Watch player'}</button>
            <button type="button" className="primary" onClick={onOpenTrade}><ArrowLeftRight size={16} /> {profile.isMyRoster ? 'Explore selling' : 'Build an offer'}</button>
          </div>
        </div>
        <div className="player-owner-strip"><span><small>Current owner</small><b>@{owner.ownerName}</b></span><span><small>Sleeper roster</small><b>{profile.rosterStatus}</b></span><span><small>Modeled lineup</small><b>{profile.modeledLineupStatus}</b></span><span><small>{asset.position} depth</small><b>{profile.positionDepth.length} players</b></span></div>
      </section>

      <section className="player-research-section panel">
        <div className="panel-heading"><div><span className="eyebrow">Current market</span><h2>Price sources stay separate</h2></div><span className="method-note">Collected {dateLabel(profile.marketAsOf)}</span></div>
        <div className="player-market-grid">
          <article><small>Tradyr composite</small><strong>{formatValue(asset.value)}</strong><span>{asset.rank === null ? 'Overall rank unavailable' : `Overall rank #${asset.rank}`}</span></article>
          <article><small>KeepTradeCut</small><strong>{sourceValue(asset.marketSources?.ktc)}</strong><span>Current attributed provider value</span></article>
          <article><small>FantasyCalc</small><strong>{sourceValue(asset.marketSources?.fantasycalc)}</strong><span>Current attributed provider value</span></article>
          <article><small>Current-season power</small><strong>{sourceValue(asset.currentSeasonValue)}</strong><span>{asset.currentSeasonPosRank ? `${asset.position}${asset.currentSeasonPosRank}` : 'Same-format rank unavailable'}</span></article>
        </div>
      </section>

      <section className="player-research-section panel">
        <div className="panel-heading"><div><span className="eyebrow">Covered production</span><h2>Football outlook is not market profit</h2></div><span className="method-note">{projection ? `${projection.productionModel ?? 'Production model'} · ${projection.gamesObserved} games` : 'Unavailable'}</span></div>
        {projection ? <><div className="player-production-grid"><article><small>Expected PPG</small><strong>{projection.expectedPpg.toFixed(1)}</strong></article><article><small>Floor</small><strong>{projection.floorPpg.toFixed(1)}</strong></article><article><small>Ceiling</small><strong>{projection.ceilingPpg.toFixed(1)}</strong></article><article><small>Source season</small><strong>{projection.sourceSeason}</strong></article></div><ul className="player-driver-list">{projection.drivers?.map((driver) => <li key={driver}>{driver}</li>)}</ul></> : <div className="player-evidence-empty"><Info size={18} /><span>No covered production projection is available. Missing production is not treated as zero.</span></div>}
      </section>

      <section className="player-research-section panel">
        <div className="panel-heading"><div><span className="eyebrow">Forward market evidence</span><h2>Select the intended holding period</h2></div><label className="holding-period-control"><span>Holding period</span><select value={holdingPeriodDays} onChange={(event) => setHoldingPeriodDays(Number(event.target.value) as ForwardHorizonDays)}><option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>365 days</option></select></label></div>
        <AssetResearchPanel asset={asset} bundle={assetReturnHealth} numQbs={leagueContext.marketFormat.numQbs} horizonYears={horizonYears} horizonDays={holdingPeriodDays} />
      </section>

      <section className="player-research-section panel">
        <div className="panel-heading"><div><span className="eyebrow">Owner context</span><h2>{owner.teamName}</h2></div><span className="method-note">Current settled Sleeper roster</span></div>
        <div className="player-depth-list">{profile.positionDepth.map((player, index) => <span key={player.id} className={player.id === asset.id ? 'selected' : ''}><b>#{index + 1}</b><strong>{player.name}</strong><em>{formatValue(player.value)}</em></span>)}</div>
        <div className="portfolio-boundary"><ShieldCheck size={16} /><span>This page shows current ownership, price, production, and promoted return evidence. It does not estimate whether @{owner.ownerName} will accept an offer.</span></div>
      </section>
    </main>
  )
}
