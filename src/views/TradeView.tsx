import { AlertTriangle, ArrowLeftRight, BookOpen, Check, GraduationCap, Info, Newspaper, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchEdgeState, fetchIntel, fetchTradeTapeState, refreshTradeTape, saveTradeDecision } from '../api'
import type { LeagueContext } from '../league-context'
import { assetRoleLabel, evaluateTrade, optimizeLineup, projectedLineupPpg } from '../rankings'
import type { ResolvedTeamStrategy } from '../strategy'
import { evaluateLeagueTradePolicy, strategyProfileForLeague } from '../leagues'
import type { Asset, EdgeStateBundle, EventModelHealthBundle, IntelFeed, Team, TeamStrategyProfile, TradyrPlayer } from '../types'
import {
  buildConsolidationStructure,
  buildHistoricalTradeEvidenceStages,
  DEFAULT_TRADE_MODEL_WEIGHTS,
  modelSignalsForTrade,
  weightTradeEvidence,
  type ConsolidationStructure,
  type TradeModelHealthBundle,
  type TradeTapeRefreshState,
  type TradeModelWeights,
  type WeightedTradeEvidence,
} from '../trade-models'
import { AssetBadge, Avatar, formatValue } from '../components/domain-ui'
import { AssetResearchPanel } from '../components/AssetResearchPanel'
import { evaluateRebuildPortfolioTrade } from '../asset-returns'
import type { AssetReturnHealthBundle, PortfolioTradeDelta } from '../asset-returns'
import type { TradeDraft } from './types'
import { buildIntelSignals } from '../intel'
import { buildCatalystTimingRead } from '../catalyst-timing'
import type { CatalystTimingRead } from '../catalyst-timing'
import { toDecisionAsset } from '../decision-journal'
import type { TradeDecisionDraft, TradeDecisionStatus } from '../decision-journal'
import { buildPickOpportunityRead } from '../pick-opportunity'
import type { PickOpportunityRead } from '../pick-opportunity'
import type { RookieBoardBundle } from '../rookies'

type TradeEvaluation = ReturnType<typeof evaluateTrade>

function TradeAssetRow({
  asset,
  selected,
  onToggle,
}: {
  asset: Asset
  selected: boolean
  onToggle: (id: string) => void
}) {
  return (
    <button
      type="button"
      className={`trade-asset-row ${selected ? 'selected' : ''}`}
      onClick={() => onToggle(asset.id)}
    >
      <AssetBadge position={asset.position} />
      <span className="trade-asset-copy">
        <strong>{asset.name}</strong>
        <small>
          {asset.kind === 'player'
            ? [asset.team, assetRoleLabel(asset), asset.projectedPpg !== undefined ? `${asset.projectedPpg.toFixed(1)} ML PPG` : null, asset.rank ? `#${asset.rank} overall` : 'Unranked'].filter(Boolean).join(' · ')
            : asset.slot
              ? 'Known slot'
              : `Unresolved midpoint · ${formatValue(asset.valueLow ?? asset.value)}–${formatValue(asset.valueHigh ?? asset.value)} range`}
        </small>
      </span>
      <b>{formatValue(asset.value)}</b>
      <span className="asset-add">{selected ? <Check size={15} /> : '+'}</span>
    </button>
  )
}
function TradeSide({
  side,
  team,
  teams,
  selectedIds,
  search,
  onSearch,
  onTeamChange,
  onToggle,
}: {
  side: 'A' | 'B'
  team: Team
  teams: Team[]
  selectedIds: string[]
  search: string
  onSearch: (value: string) => void
  onTeamChange: (rosterId: number) => void
  onToggle: (id: string) => void
}) {
  const allAssets = useMemo(
    () => [...team.players, ...team.picks].sort((a, b) => b.value - a.value),
    [team],
  )
  const filtered = allAssets.filter((asset) =>
    `${asset.name} ${asset.position} ${asset.team ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  )
  const selected = allAssets.filter((asset) => selectedIds.includes(asset.id))

  return (
    <section className={`trade-side side-${side.toLowerCase()} panel`}>
      <div className="side-heading">
        <span className="side-label">Side {side} gives</span>
        <span>{selected.length} selected</span>
      </div>
      <label className="team-select-wrap">
        <Avatar team={team} size="sm" />
        <span>
          <small>Trading team</small>
          <select value={team.rosterId} onChange={(event) => onTeamChange(Number(event.target.value))}>
            {teams.map((option) => (
              <option key={option.rosterId} value={option.rosterId}>{option.teamName}</option>
            ))}
          </select>
        </span>
      </label>

      <div className="selected-assets">
        {selected.length ? (
          selected.map((asset) => (
            <button type="button" key={asset.id} onClick={() => onToggle(asset.id)}>
              <AssetBadge position={asset.position} />
              <span>{asset.shortName ?? asset.name}</span>
              <X size={14} />
            </button>
          ))
        ) : (
          <div className="empty-selection">
            <ArrowLeftRight size={18} />
            Choose what {team.teamName} sends
          </div>
        )}
      </div>

      <label className="asset-search">
        <Search size={17} />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search roster or picks"
        />
      </label>
      <div className="trade-asset-list">
        {filtered.map((asset) => (
          <TradeAssetRow
            key={asset.id}
            asset={asset}
            selected={selectedIds.includes(asset.id)}
            onToggle={onToggle}
          />
        ))}
        {!filtered.length && <p className="no-results">No assets match that search.</p>}
      </div>
    </section>
  )
}

function TradeVerdict({
  teamA,
  teamB,
  result,
  ready,
  leagueContext,
}: {
  teamA: Team
  teamB: Team
  result: TradeEvaluation
  ready: boolean
  leagueContext: LeagueContext
}) {
  const lead = result.winner === 'A' ? 'a' : result.winner === 'B' ? 'b' : 'even'
  const compactVerdict = result.verdict
    .replace(teamA.teamName, 'Side A')
    .replace(teamB.teamName, 'Side B')
  return (
    <section className="trade-verdict panel">
      <div className={`verdict-orb verdict-${lead}`}>
        <Info size={23} />
        <span>{compactVerdict}</span>
      </div>
      <div className="value-versus">
        <span><small>{teamA.teamName} sends</small><strong>{formatValue(result.valueA)}</strong></span>
        <b>vs</b>
        <span><small>{teamB.teamName} sends</small><strong>{formatValue(result.valueB)}</strong></span>
      </div>
      <p className="verdict-copy">
        {!ready
          ? 'Select at least one asset on each side to compare the current provider values.'
          : `${result.difference.toFixed(1)}% separates the current composite totals. This is a price comparison, not a trade grade or prediction.`}
      </p>
      {ready && (
        <div className="trade-lenses">
          <span><small>Side A current-price net</small><b className={result.marketNetA > 0 ? 'positive' : result.marketNetA < 0 ? 'negative' : ''}>{result.marketNetA > 0 ? '+' : ''}{formatValue(result.marketNetA)}</b></span>
          <span><small>Power coverage</small><b>{result.currentSeasonScenarioA?.before.coveragePercent ?? 0}%</b></span>
          <span><small>Side A lineup power</small><b>{result.currentSeasonImpactA === null ? 'Not available' : `${result.currentSeasonImpactA >= 0 ? '+' : ''}${result.currentSeasonImpactA}`}</b></span>
        </div>
      )}
      {ready && (result.riskNotesA.length > 0 || result.riskNotesB.length > 0) && (
        <div className="trade-risk-list">
          {result.riskNotesA.slice(0, 2).map((note) => <p key={`a-${note}`}><AlertTriangle size={14} /><span><strong>Side A:</strong> {note}</span></p>)}
          {result.riskNotesB.slice(0, 2).map((note) => <p key={`b-${note}`}><AlertTriangle size={14} /><span><strong>Side B:</strong> {note}</span></p>)}
        </div>
      )}
      {ready && (result.projectionNotesA.length > 0 || result.projectionNotesB.length > 0) && (
        <div className="trade-risk-list trade-projection-list">
          {result.projectionNotesA.slice(0, 2).map((note) => <p key={`pa-${note}`}><Info size={14} /><span><strong>Side A receives:</strong> {note}</span></p>)}
          {result.projectionNotesB.slice(0, 2).map((note) => <p key={`pb-${note}`}><Info size={14} /><span><strong>Side B receives:</strong> {note}</span></p>)}
        </div>
      )}
      <div className="model-note">
        <Info size={16} />
        <span>The held-out ML target is generic PPR per team week. For {leagueContext.label}, TE projections add the exact +{leagueContext.scoring.tePremiumPerReception} reception bonus where observed reception-rate evidence exists. Uncovered players remain uncovered; market value is never converted into fantasy points.</span>
      </div>
    </section>
  )
}

function RosterImpact({
  teamA,
  teamB,
  sideA,
  sideB,
  result,
  horizonYears,
}: {
  teamA: Team
  teamB: Team
  sideA: Asset[]
  sideB: Asset[]
  result: TradeEvaluation
  horizonYears: number
}) {
  const netA = result.marketNetA
  const netB = -result.marketNetA
  const topA = [...sideA].sort((a, b) => b.value - a.value)[0]
  const topB = [...sideB].sort((a, b) => b.value - a.value)[0]
  const spotsA = sideA.length - sideB.length

  const rows = [
    { label: 'Current market value', a: netA, b: netB, suffix: '', decimals: false },
    { label: 'Current-season lineup power', a: result.currentSeasonImpactA, b: result.currentSeasonImpactB, suffix: '', decimals: false },
    { label: 'Expected lineup PPG', a: result.lineupImpactA, b: result.lineupImpactB, suffix: '', decimals: true },
    { label: 'Current pick value', a: result.pickValueNetA, b: -result.pickValueNetA, suffix: '', decimals: false },
    { label: 'Roster spots opened', a: spotsA, b: -spotsA, suffix: '', decimals: false },
  ]

  const displayMetric = (value: number | null, decimals: boolean) => {
    if (value === null) return 'Guarded'
    return `${value > 0 ? '+' : ''}${decimals ? value.toFixed(1) : formatValue(value)}`
  }

  return (
    <section className="impact-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Deal context</span>
          <h2>What changes after the trade</h2>
        </div>
        <span className="method-note">Price, production, and role separated</span>
      </div>
      <div className="impact-grid">
        <div className="impact-team-name"><Avatar team={teamA} size="sm" /><span><small>Side A</small><strong>{teamA.teamName}</strong></span></div>
        <span className="impact-spacer" />
        <div className="impact-team-name align-right"><span><small>Side B</small><strong>{teamB.teamName}</strong></span><Avatar team={teamB} size="sm" /></div>
        {rows.map((row) => (
          <div className="impact-row" key={row.label}>
            <b className={row.a !== null && row.a > 0 ? 'positive' : row.a !== null && row.a < 0 ? 'negative' : ''}>{displayMetric(row.a, row.decimals)}{row.suffix}</b>
            <span>{row.label}</span>
            <b className={row.b !== null && row.b > 0 ? 'positive' : row.b !== null && row.b < 0 ? 'negative' : ''}>{displayMetric(row.b, row.decimals)}{row.suffix}</b>
          </div>
        ))}
        {(result.rangeA.worst !== result.rangeA.best || result.rangeB.worst !== result.rangeB.best) && (
          <div className="impact-row impact-range-row">
            <b>{formatValue(result.rangeA.worst)} to {formatValue(result.rangeA.best)}</b>
            <span>Pick scenario range</span>
            <b>{formatValue(result.rangeB.worst)} to {formatValue(result.rangeB.best)}</b>
          </div>
        )}
        <div className="impact-row impact-range-row">
          <b>{result.packageB.averageAgeAtHorizon === null ? 'No incoming player age' : result.packageB.averageAgeAtHorizon.toFixed(1)}</b>
          <span>Incoming age in {horizonYears} years</span>
          <b>{result.packageA.averageAgeAtHorizon === null ? 'No incoming player age' : result.packageA.averageAgeAtHorizon.toFixed(1)}</b>
        </div>
        <div className="impact-row">
          <b>{topB?.name ?? '—'}</b>
          <span>Best asset received</span>
          <b>{topA?.name ?? '—'}</b>
        </div>
      </div>
    </section>
  )
}

function ScenarioPanel({
  result,
  teamA,
  strategy,
  strategyRosterId,
}: {
  result: TradeEvaluation
  teamA: Team
  strategy: ResolvedTeamStrategy
  strategyRosterId: number
}) {
  const signed = (value: number | null, suffix = '', decimals = false) => value === null
    ? 'Unavailable'
    : `${value > 0 ? '+' : ''}${decimals ? value.toFixed(1) : formatValue(value)}${suffix}`
  const production = result.lineupScenarioA
  const currentSeason = result.currentSeasonScenarioA
  const sourceCoverage = Math.min(result.packageA.providerCoveragePercent, result.packageB.providerCoveragePercent)
  const providerTotalsApplicable = result.packageA.providerTotalsApplicable && result.packageB.providerTotalsApplicable
  const objectiveApplies = teamA.rosterId === strategyRosterId

  return (
    <section className="scenario-panel panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Honest scenario simulator</span><h2>Five lenses, no blended grade</h2></div>
        <span className="method-note">{objectiveApplies ? `${strategy.mode} · ${strategy.horizonYears}-year horizon` : 'Factual comparison only'}</span>
      </div>
      <div className="scenario-grid">
        <article>
          <small>Provider disagreement</small>
          <strong>{providerTotalsApplicable ? `${sourceCoverage}% dual-source coverage` : 'Player-only lens unavailable'}</strong>
          <span>KTC player lens <b>{signed(result.providerNetA.ktc)}</b></span>
          <span>FantasyCalc player lens <b>{signed(result.providerNetA.fantasycalc)}</b></span>
          {!providerTotalsApplicable && <em>Picks have no value on either provider’s player scale.</em>}
        </article>
        <article>
          <small>Starting-lineup power</small>
          <strong>{signed(result.currentSeasonImpactA)} power</strong>
          <span>Before <b>{currentSeason?.before.score.toLocaleString() ?? 'Unavailable'}</b></span>
          <span>After <b>{currentSeason?.after.score.toLocaleString() ?? 'Unavailable'}</b></span>
          {currentSeason && <em>{currentSeason.before.covered}/{currentSeason.before.required} redraft-valued slots before · {currentSeason.after.covered}/{currentSeason.after.required} after</em>}
        </article>
        <article>
          <small>Covered production</small>
          <strong>{production?.complete ? signed(production.expectedDelta, ' PPG', true) : 'Lineup guarded'}</strong>
          <span>Floor <b>{signed(production?.floorDelta ?? null, ' PPG', true)}</b></span>
          <span>Expected <b>{signed(production?.expectedDelta ?? null, ' PPG', true)}</b></span>
          <span>Ceiling <b>{signed(production?.ceilingDelta ?? null, ' PPG', true)}</b></span>
          {production && <em>{production.beforeCoverage.covered}/{production.beforeCoverage.required} modeled slots before · {production.afterCoverage.covered}/{production.afterCoverage.required} after</em>}
        </article>
        <article>
          <small>Pick-position scenarios</small>
          <strong>{signed(result.marketNetA)} current net</strong>
          <span>Downside <b>{signed(result.rangeA.worst)}</b></span>
          <span>Upside <b>{signed(result.rangeA.best)}</b></span>
          <em>Ranges come only from unresolved pick slots.</em>
        </article>
        <article>
          <small>Declared horizon facts</small>
          <strong>{strategy.horizonYears} years forward</strong>
          <span>Outgoing player age <b>{result.packageA.averageAgeAtHorizon?.toFixed(1) ?? 'Unavailable'}</b></span>
          <span>Incoming player age <b>{result.packageB.averageAgeAtHorizon?.toFixed(1) ?? 'Unavailable'}</b></span>
          <span>Draft-capital net <b>{signed(result.pickValueNetA)}</b></span>
        </article>
      </div>
      <div className="model-note scenario-note">
        <Info size={16} />
        <span>{objectiveApplies
          ? `Side A is your saved team, so the ${strategy.mode} objective is shown as explicit horizon facts. The separate portfolio memo uses only promoted 30-day resale evidence.`
          : `Your saved strategy belongs to another roster. This deal keeps the ${strategy.horizonYears}-year age facts visible but does not label either side as your rebuild.`}</span>
      </div>
    </section>
  )
}

function RebuildPortfolioPanel({
  portfolio,
  team,
  incoming,
  bundle,
  numQbs,
  horizonYears,
}: {
  portfolio: PortfolioTradeDelta
  team: Team
  incoming: Asset[]
  bundle: AssetReturnHealthBundle | null
  numQbs: 1 | 2
  horizonYears: number
}) {
  const signed = (value: number | null, unit = '', digits = 0) => value === null
    ? 'Unavailable'
    : `${value > 0 ? '+' : ''}${value.toFixed(digits)}${unit}`
  const lowerImproves = (portfolio.trackedAssetLowerPnl30 ?? 0) >= 0
  return (
    <section className="rebuild-portfolio panel">
      <div className="panel-heading">
        <div><span className="eyebrow">V7.7 rebuild portfolio memo</span><h2>Return, downside, liquidity, and decay stay separate</h2></div>
        <span className="method-note">{team.teamName} · {horizonYears}-year objective</span>
      </div>
      <div className="portfolio-delta-grid">
        <article><small>Current Tradyr value</small><strong className={portfolio.currentValue >= 0 ? 'positive' : 'negative'}>{signed(portfolio.currentValue)}</strong><span>Today’s composite-price change</span></article>
        <article><small>Expected 30-day P&amp;L</small><strong className={(portfolio.expectedPnl30 ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(portfolio.expectedPnl30)}</strong><span>FantasyCalc-value units · {Math.round(portfolio.returnCoverage * 100)}% post-trade coverage</span></article>
        <article><small>Tracked downside P&amp;L</small><strong className={lowerImproves ? 'positive' : 'negative'}>{signed(portfolio.trackedAssetLowerPnl30)}</strong><span>Change in the calibrated tracked-asset lower interval</span></article>
        <article><small>Draft capital</small><strong className={portfolio.pickValue >= 0 ? 'positive' : 'negative'}>{signed(portfolio.pickValue)}</strong><span>Pick-share change {signed(portfolio.pickValueShare === null ? null : portfolio.pickValueShare * 100, ' pp', 1)}</span></article>
        <article><small>Concentration</small><strong>{signed(portfolio.concentrationHhi, '', 3)}</strong><span>HHI change · lower is more diversified</span></article>
        <article><small>Age at your horizon</small><strong>{signed(portfolio.valueWeightedAgeAtHorizon, ' yrs', 1)}</strong><span>Change in value-weighted player age</span></article>
        <article><small>Historical drawdown</small><strong>{signed(portfolio.maxDrawdown180 === null ? null : portfolio.maxDrawdown180 * 100, ' pp', 1)}</strong><span>Change in weighted 180-day max drawdown · {Math.round(portfolio.historicalRiskCoverage * 100)}% coverage</span></article>
        <article><small>Market liquidity</small><strong>{signed(portfolio.tradeFrequency, '/day', 1)}</strong><span>Change in weighted FantasyCalc trade frequency</span></article>
      </div>
      <div className="portfolio-boundary"><Info size={16} /><span>The 30-day model is promoted for this exact horizon. It does not forecast your three-year roster value, manager acceptance, or a guaranteed flip. Missing assets contribute no assumed return.</span></div>
      {incoming.length > 0 && <div className="incoming-research-stack">
        <div className="panel-heading"><div><span className="eyebrow">Incoming asset research</span><h3>Hold and exit evidence</h3></div><span className="method-note">Up to three incoming assets</span></div>
        {incoming.slice(0, 3).map((asset) => <AssetResearchPanel key={asset.id} asset={asset} bundle={bundle} numQbs={numQbs} horizonYears={horizonYears} compact />)}
      </div>}
    </section>
  )
}

function CatalystTimingPanel({ read }: { read: CatalystTimingRead }) {
  return (
    <section className="catalyst-timing-panel panel">
      <div className="panel-heading">
        <div><span className="eyebrow">V8.1 catalyst experiment</span><h2>News can time a thesis only after proving incremental lift</h2></div>
        <span className={`method-note ${read.timingInfluenceEnabled ? 'positive' : ''}`}>{read.timingInfluenceEnabled ? 'Timing evidence promoted' : 'Advisory only'}</span>
      </div>
      <div className="catalyst-gates">
        <article><small>Production event model</small><strong>{read.productionEventModelEnabled ? 'Enabled' : 'Blocked'}</strong><span>{read.productionChecksPassed}/{read.productionChecksTotal} held-out checks passed</span></article>
        <article><small>Market event model</small><strong>{read.marketEventModelEnabled ? 'Enabled' : 'Not validated'}</strong><span>{read.marketStatus} generic return model; no incremental event challenger</span></article>
        <article><small>Trade influence</small><strong>{read.timingInfluenceEnabled ? 'Allowed' : 'None'}</strong><span>Target order and price remain unchanged</span></article>
      </div>
      {read.events.length ? <div className="catalyst-event-list">{read.events.slice(0, 6).map((event) => <article key={`${event.playerId}:${event.article.id}`}>
        <Newspaper size={16} />
        <div><strong>{event.playerName}: {event.article.title}</strong><span>{event.article.source} · {new Date(event.article.publishedAt).toLocaleString()} · {event.article.eventType ?? 'general'} event</span></div>
        <div><small>Observed matching 30-day cohort</small><b>{event.marketCohort ? `${event.marketCohort.actualReturn >= 0 ? '+' : ''}${(event.marketCohort.actualReturn * 100).toFixed(1)}% · n=${event.marketCohort.sampleSize}` : 'No private cohort yet'}</b></div>
      </article>)}</div> : <div className="intel-empty compact"><Newspaper size={20} /><strong>No linked current report for the incoming players.</strong><span>Absence of a report is not a negative signal.</span></div>}
      <div className="model-note"><Info size={16} /><span>{read.method}</span></div>
    </section>
  )
}

function PickOpportunityPanel({ reads }: { reads: PickOpportunityRead[] }) {
  if (!reads.length) return null
  return (
    <section className="pick-opportunity-panel panel">
      <div className="panel-heading"><div><span className="eyebrow">V8.2 rookie opportunity cost</span><h2>Price the pick and inspect the possible players separately</h2></div><span className="method-note">No prospect percentile becomes pick value</span></div>
      <div className="pick-opportunity-list">{reads.map((read) => <article key={read.asset.id}>
        <header><GraduationCap size={18} /><div><strong>{read.asset.name}</strong><span>{read.title}</span></div><b>{formatValue(read.priceRange.low)}–{formatValue(read.priceRange.high)}</b></header>
        {read.candidates.length ? <div className="pick-candidate-grid">{read.candidates.map((candidate) => <span key={`${read.asset.id}:${candidate.sleeperId ?? candidate.name}`}><AssetBadge position={candidate.position} /><strong>{candidate.name}</strong><small>Market #{candidate.rookieMarketRank} · production {(candidate.expectedProductionPercentile * 100).toFixed(0)}%</small><em>{Object.values(candidate.availableByRule).filter(Boolean).length}/{Object.keys(candidate.availableByRule).length} availability rules</em></span>)}</div> : <p>{read.evidence.join(' ')}</p>}
        {read.candidates.length > 0 && <p>{read.evidence.join(' ')}</p>}
        <details><summary>Model boundary</summary><ul>{read.boundary.map((boundary) => <li key={boundary}>{boundary}</li>)}</ul></details>
      </article>)}</div>
    </section>
  )
}

function DecisionJournalPanel({ draft }: { draft: TradeDecisionDraft }) {
  const [status, setStatus] = useState<TradeDecisionStatus>(draft.status)
  const [thesis, setThesis] = useState(draft.thesis)
  const [holdPeriod, setHoldPeriod] = useState(draft.holdPeriod)
  const [exitCondition, setExitCondition] = useState(draft.exitCondition)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const decision = await saveTradeDecision({ ...draft, status, thesis, holdPeriod, exitCondition })
      setSaved(decision.id)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Decision could not be saved')
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="decision-journal-panel panel">
      <div className="panel-heading"><div><span className="eyebrow">V8.0 private decision journal</span><h2>Save the offer, thesis, hold period, and exit before negotiating</h2></div><span className="method-note">Private account + league record</span></div>
      <div className="decision-journal-form">
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as TradeDecisionStatus)}><option value="researching">Researching</option><option value="offered">Offered</option><option value="countered">Countered</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="withdrawn">Withdrawn</option></select></label>
        <label className="wide"><span>Decision thesis</span><textarea value={thesis} onChange={(event) => setThesis(event.target.value)} rows={3} /></label>
        <label><span>Intended hold period</span><input value={holdPeriod} onChange={(event) => setHoldPeriod(event.target.value)} /></label>
        <label><span>Exit / failure condition</span><input value={exitCondition} onChange={(event) => setExitCondition(event.target.value)} /></label>
      </div>
      <div className="decision-journal-actions"><span>{draft.catalysts.length} current catalyst{draft.catalysts.length === 1 ? '' : 's'} attached · exact evaluation snapshot saved</span><button type="button" onClick={() => void save()} disabled={saving || !thesis.trim() || !holdPeriod.trim() || !exitCondition.trim()}><BookOpen size={15} /> {saving ? 'Saving…' : saved ? 'Saved to journal' : 'Save decision'}</button></div>
      {error && <div className="intel-error">{error}</div>}
    </section>
  )
}

function PremiumModelPanel({
  structure,
  health,
  weights,
  weighted,
  onWeightsChange,
  onWeightsCommit,
  tape,
  tapeRefreshing,
  tapeError,
  onTapeRefresh,
}: {
  structure: ConsolidationStructure | null
  health: TradeModelHealthBundle | null
  weights: TradeModelWeights
  weighted: WeightedTradeEvidence
  onWeightsChange: (weights: TradeModelWeights) => void
  onWeightsCommit: (weights: TradeModelWeights) => void
  tape: TradeTapeRefreshState | null
  tapeRefreshing: boolean
  tapeError: string | null
  onTapeRefresh: () => void
}) {
  const exchange = health?.exchange
  const outcome = health?.outcomes.find((item) => item.horizonDays === weights.outcomeHorizon)
  const evidenceStages = buildHistoricalTradeEvidenceStages(tape, health, weighted)
  const activeLanes = weighted.contributions
    .filter((item) => item.weight > 0 && item.contribution !== null)
    .map((item) => item.id === 'lineup' ? 'covered production' : item.id === 'exchange' ? 'exchange premium' : item.id === 'outcome' ? 'future outcome' : 'current market')
  const historicalInfluence = evidenceStages.find((stage) => stage.id === 'influencing')?.status === 'ready'
  const signalLabel = weighted.coveredSignal === null
    ? 'No weighted evidence'
    : `${weighted.coveredSignal >= 0 ? '+' : ''}${weighted.coveredSignal.toFixed(1)}% toward Side A`
  const setWeight = (key: 'market' | 'lineup' | 'exchange' | 'outcome', value: number) => {
    onWeightsChange({ ...weights, [key]: Math.max(0, Math.min(100, value)) })
  }
  const commitWeight = (key: 'market' | 'lineup' | 'exchange' | 'outcome', value: number) => {
    onWeightsCommit({ ...weights, [key]: Math.max(0, Math.min(100, value)) })
  }
  const setOutcomeSetting = <K extends 'outcomeHorizon' | 'outcomeVariant'>(key: K, value: TradeModelWeights[K]) => {
    const next = { ...weights, [key]: value }
    onWeightsChange(next)
    onWeightsCommit(next)
  }
  const exchangeStatus = exchange?.status === 'needs-data'
    ? 'Needs more tape'
    : exchange?.status === 'shadow'
      ? 'Shadow only'
      : exchange?.status === 'validated'
        ? 'Validated'
        : 'Unavailable'
  const tapeStatus = tape?.status === 'never-refreshed'
    ? 'Not refreshed yet'
    : tape?.status === 'partial'
      ? 'Partial refresh'
      : tape?.status === 'failed'
        ? 'Last refresh failed'
        : tape?.status === 'refreshing'
          ? 'Refreshing'
          : tape
            ? 'Current tape saved'
            : 'Loading tape status'
  return (
    <section className="premium-model-panel panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Consolidation research</span><h2>Raw price, exchange premium, and outcome stay separate</h2></div>
        <div className="tape-actions">
          <a className="tape-export-button" href="/api/trade-tape?format=training" download>Download training tape</a>
          <button className="tape-refresh-button" type="button" onClick={onTapeRefresh} disabled={tapeRefreshing}>
            <RefreshCw size={15} className={tapeRefreshing ? 'spin' : ''} />
            {tapeRefreshing ? 'Refreshing tape…' : 'Refresh historical tape'}
          </button>
        </div>
      </div>
      <div className={`tape-refresh-status ${tapeError ? 'has-error' : ''}`}>
        <span><strong>{tapeStatus}</strong>{tape?.lastSuccessAt ? ` · last saved ${new Date(tape.lastSuccessAt).toLocaleString()}` : ''}</span>
        <small>{tapeError ?? 'One click scans a fixed market sample, deduplicates completed trades, and saves only new rows to private storage.'}</small>
      </div>
      <div className={`trade-evidence-verdict ${historicalInfluence ? 'active' : 'inactive'}`}>
        <span><strong>Evidence influencing this trade</strong>{activeLanes.length ? activeLanes.join(' + ') : 'No promoted evidence selected'}</span>
        <b>{historicalInfluence ? 'Historical models active' : 'Historical models not applied'}</b>
      </div>
      <div className="trade-evidence-pipeline" aria-label="Historical trade evidence pipeline">
        {evidenceStages.map((stage) => (
          <article className={stage.status} key={stage.id}>
            <small>{stage.label}</small>
            <strong>{stage.status}</strong>
            <span>{stage.detail}</span>
          </article>
        ))}
      </div>
      <div className="premium-model-summary">
        <article>
          <small>This deal</small>
          <strong>{structure ? `${structure.packageAssets.length}-for-1` : 'Not 2/3-for-1'}</strong>
          <span>{structure
            ? `${structure.eliteAsset.name} is ${Math.round(structure.elitePercentile * 100)}th percentile; package is ${Math.abs(structure.actualPremium * 100).toFixed(1)}% ${structure.actualPremium >= 0 ? 'above' : 'below'} its raw price.`
            : 'The exchange-premium target applies only when one side sends one asset and the other sends two or three.'}</span>
        </article>
        <article>
          <small>Stored completed-trade tape</small>
          <strong>{tape ? `${tape.totalTrades} trades · ${tape.uniqueLeagues} leagues` : 'Loading'}</strong>
          <span>{tape?.latestRun
            ? `${tape.latestRun.newTrades} new in the last refresh; ${tape.latestRun.anchorsSucceeded}/${tape.latestRun.anchorsAttempted} anchors succeeded.`
            : 'No user-triggered collection run is stored yet.'}</span>
        </article>
        <article>
          <small>Last trained exchange artifact</small>
          <strong>{exchange ? `${exchangeStatus} · ${exchange.rows} eligible trades` : 'Unavailable'}</strong>
          <span>{exchange?.medianPremium === null || exchange?.medianPremium === undefined
            ? 'No point-in-time accepted-trade estimate yet.'
            : `${(exchange.medianPremium * 100).toFixed(1)}% observed median across ${exchange.dateSpanDays} days. ${exchange.enabled ? 'Held-out gates passed.' : 'Research only; not applied.'}`}</span>
        </article>
        <article>
          <small>{weights.outcomeHorizon}-day outcome</small>
          <strong>{outcome ? `${outcome.status} · ${outcome.rows} labels` : 'Unavailable'}</strong>
          <span>{outcome?.enabled
            ? `${weights.outcomeVariant === 'premiumAware' ? 'Premium-aware' : 'Structure-only'} held-out model is available.`
            : 'No future labels yet. A price premium is not being treated as future profit.'}</span>
        </article>
        <article>
          <small>User-weighted direction</small>
          <strong>{signalLabel}</strong>
          <span>{Math.round(weighted.weightCoverage * 100)}% of your requested weight has promoted evidence. Missing weight is exposed, never redistributed.</span>
        </article>
      </div>
      <div className="trade-weight-controls">
        {(['market', 'lineup', 'exchange', 'outcome'] as const).map((key) => {
          const contribution = weighted.contributions.find((item) => item.id === key)
          return (
            <label key={key}>
              <span><strong>{key === 'exchange' ? 'Exchange premium' : key === 'outcome' ? 'Future outcome' : key === 'lineup' ? 'Covered production' : 'Market'}</strong><b>{weights[key]}</b></span>
              <input type="range" min="0" max="100" value={weights[key]} onChange={(event) => setWeight(key, Number(event.target.value))} onPointerUp={(event) => commitWeight(key, Number(event.currentTarget.value))} onKeyUp={(event) => commitWeight(key, Number(event.currentTarget.value))} />
              <small>{contribution?.signal === null ? 'Not promoted' : `${contribution?.signal && contribution.signal >= 0 ? '+' : ''}${contribution?.signal?.toFixed(1)}% Side A signal`}</small>
            </label>
          )
        })}
        <label className="trade-weight-select"><span><strong>Outcome horizon</strong></span><select value={weights.outcomeHorizon} onChange={(event) => setOutcomeSetting('outcomeHorizon', Number(event.target.value) as 90 | 180 | 365)}><option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>365 days</option></select><small>Held-out horizon</small></label>
        <label className="trade-weight-select"><span><strong>Outcome model</strong></span><select value={weights.outcomeVariant} onChange={(event) => setOutcomeSetting('outcomeVariant', event.target.value as TradeModelWeights['outcomeVariant'])}><option value="structureOnly">Without paid premium</option><option value="premiumAware">With paid premium</option></select><small>Compare challengers</small></label>
      </div>
      <div className="model-note premium-model-note"><Info size={16} /><span>The refresh grows the raw D1 tape. Download exports its sanitized, content-addressed training input; neither action retrains or promotes the browser artifact. The last trained artifact is dated {health?.generatedAt ? new Date(health.generatedAt).toLocaleString() : 'unavailable'}. Accepted trades reveal exchange prices, not rejected offers or acceptance probability.</span></div>
    </section>
  )
}

export function TradeView({
  teams,
  leagueId,
  rosterPositions,
  leagueContext,
  initialDraft,
  strategy,
  strategyRosterId,
  onStrategyChange,
  tradeModelHealth,
  tradeModelWeights,
  onTradeModelWeightsChange,
  marketPopulation,
  marketVersion,
  valuePlayers,
  assetReturnHealth,
  eventModelHealth,
  rookieBoard,
}: {
  teams: Team[]
  leagueId: string
  rosterPositions: string[]
  leagueContext: LeagueContext
  initialDraft?: TradeDraft | null
  strategy: ResolvedTeamStrategy
  strategyRosterId: number
  onStrategyChange: (strategy: TeamStrategyProfile) => void
  tradeModelHealth: TradeModelHealthBundle | null
  tradeModelWeights?: TradeModelWeights
  onTradeModelWeightsChange: (weights: TradeModelWeights) => void
  marketPopulation: number[]
  marketVersion: string
  valuePlayers: TradyrPlayer[]
  assetReturnHealth: AssetReturnHealthBundle | null
  eventModelHealth: EventModelHealthBundle | null
  rookieBoard: RookieBoardBundle | null
}) {
  const [teamAId, setTeamAId] = useState(initialDraft?.teamAId ?? strategyRosterId)
  const [teamBId, setTeamBId] = useState(initialDraft?.teamBId ?? teams[1]?.rosterId ?? teams[0].rosterId)
  const [selectedA, setSelectedA] = useState<string[]>(initialDraft?.selectedA ?? [])
  const [selectedB, setSelectedB] = useState<string[]>(initialDraft?.selectedB ?? [])
  const [searchA, setSearchA] = useState('')
  const [searchB, setSearchB] = useState('')
  const [weights, setWeights] = useState<TradeModelWeights>(() => ({ ...DEFAULT_TRADE_MODEL_WEIGHTS, ...(tradeModelWeights ?? {}) }))
  const [tape, setTape] = useState<TradeTapeRefreshState | null>(null)
  const [tapeRefreshing, setTapeRefreshing] = useState(false)
  const [tapeError, setTapeError] = useState<string | null>(null)
  const [intelFeed, setIntelFeed] = useState<IntelFeed | null>(null)
  const [tradeEdgeState, setTradeEdgeState] = useState<EdgeStateBundle | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchTradeTapeState().then((state) => {
      if (!cancelled) setTape(state)
    }).catch((loadError) => {
      if (!cancelled) setTapeError(loadError instanceof Error ? loadError.message : 'Tape status unavailable')
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    let cancelled = false
    void Promise.all([
      fetchIntel().catch(() => null),
      fetchEdgeState(leagueId).catch(() => null),
    ]).then(([feed, edge]) => {
      if (cancelled) return
      setIntelFeed(feed)
      setTradeEdgeState(edge)
    })
    return () => { cancelled = true }
  }, [leagueId])
  const teamA = teams.find((team) => team.rosterId === teamAId) ?? teams[0]
  const teamB = teams.find((team) => team.rosterId === teamBId) ?? teams[1] ?? teams[0]
  const assetsA = [...teamA.players, ...teamA.picks].filter((asset) => selectedA.includes(asset.id))
  const assetsB = [...teamB.players, ...teamB.picks].filter((asset) => selectedB.includes(asset.id))
  const result = evaluateTrade(assetsA, assetsB, {
    teamA,
    teamB,
    rosterPositions,
    horizonYears: strategy.horizonYears,
  })
  const ready = assetsA.length > 0 && assetsB.length > 0
  const structure = ready ? buildConsolidationStructure({
    sideA: assetsA,
    sideB: assetsB,
    teamA,
    teamB,
    marketPopulation,
    leagueContext,
  }) : null
  const averageRawValue = (result.valueA + result.valueB) / 2
  const rawMarketPercent = ready && averageRawValue > 0 ? (result.marketNetA / averageRawValue) * 100 : null
  const beforeLineup = optimizeLineup(teamA.players, rosterPositions).reduce((sum, asset) => sum + projectedLineupPpg(asset), 0)
  const lineupPercent = result.lineupImpactA === null || beforeLineup <= 0 ? null : (result.lineupImpactA / beforeLineup) * 100
  const signals = modelSignalsForTrade({ rawMarketPercent, lineupPercent, structure, health: tradeModelHealth, weights })
  const weighted = weightTradeEvidence(signals, weights)
  const privateStrategy = strategyProfileForLeague(leagueContext.id, strategyRosterId)
  const strategyTeam = teamA.rosterId === strategyRosterId ? teamA : teamB.rosterId === strategyRosterId ? teamB : null
  const strategyOutgoing = strategyTeam?.rosterId === teamA.rosterId ? assetsA : assetsB
  const strategyIncoming = strategyTeam?.rosterId === teamA.rosterId ? assetsB : assetsA
  const intelSignals = useMemo(
    () => intelFeed ? buildIntelSignals(intelFeed, valuePlayers, teams, strategyRosterId) : [],
    [intelFeed, valuePlayers, teams, strategyRosterId],
  )
  const catalystRead = useMemo(() => buildCatalystTimingRead({
    incoming: strategyIncoming ?? [],
    signals: intelSignals,
    eventHealth: eventModelHealth,
    calibration: tradeEdgeState?.calibration ?? [],
    shadowModel: tradeEdgeState?.shadowModel ?? null,
  }), [strategyIncoming, intelSignals, eventModelHealth, tradeEdgeState])
  const privateDecision = privateStrategy && strategyTeam && ready
    ? evaluateLeagueTradePolicy(privateStrategy, {
        marketNetToMe: strategyTeam.rosterId === teamA.rosterId ? result.marketNetA : -result.marketNetA,
        currentSeasonPowerDelta: strategyTeam.rosterId === teamA.rosterId
          ? result.currentSeasonImpactA
          : result.currentSeasonImpactB,
        outgoing: strategyOutgoing,
        incoming: strategyIncoming,
      })
    : null
  const portfolio = ready && strategyTeam && (strategy.mode === 'rebuilding' || strategy.mode === 'retooling')
    ? evaluateRebuildPortfolioTrade({
        team: strategyTeam,
        outgoing: strategyOutgoing,
        incoming: strategyIncoming,
        bundle: assetReturnHealth,
        numQbs: leagueContext.marketFormat.numQbs,
        horizonYears: strategy.horizonYears,
      })
    : null
  const pickOpportunityReads = useMemo(
    () => ready && strategyTeam
      ? [...strategyOutgoing, ...strategyIncoming]
        .flatMap((asset) => {
          const read = buildPickOpportunityRead(asset, rookieBoard)
          return read ? [read] : []
        })
      : [],
    [ready, strategyTeam, strategyOutgoing, strategyIncoming, rookieBoard],
  )
  const decisionDraft = ready && strategyTeam ? (() => {
    const myIsA = strategyTeam.rosterId === teamA.rosterId
    const counterpart = myIsA ? teamB : teamA
    const marketNetToMe = myIsA ? result.marketNetA : -result.marketNetA
    const currentSeasonPowerDelta = myIsA ? result.currentSeasonImpactA : result.currentSeasonImpactB
    const lineupPpgDelta = myIsA ? result.lineupImpactA : result.lineupImpactB
    const providerNetToMe = myIsA
      ? result.providerNetA
      : {
          ktc: result.providerNetA.ktc === null ? null : -result.providerNetA.ktc,
          fantasycalc: result.providerNetA.fantasycalc === null ? null : -result.providerNetA.fantasycalc,
        }
    const catalysts = catalystRead.events.slice(0, 10).map((event) => ({
      id: event.article.id,
      title: event.article.title,
      url: event.article.url,
      source: event.article.source,
      publishedAt: event.article.publishedAt,
      eventType: event.article.eventType,
      eventDirection: event.article.eventDirection,
      playerId: event.playerId,
      playerName: event.playerName,
    }))
    return {
      leagueId,
      status: 'researching' as const,
      myRosterId: strategyTeam.rosterId,
      counterpartRosterId: counterpart.rosterId,
      send: strategyOutgoing.map(toDecisionAsset),
      receive: strategyIncoming.map(toDecisionAsset),
      snapshot: {
        capturedAt: new Date().toISOString(),
        marketNetToMe,
        currentSeasonPowerDelta,
        lineupPpgDelta,
        providerNetToMe,
        pickValueNetToMe: myIsA ? result.pickValueNetA : -result.pickValueNetA,
        expectedPnl30: portfolio?.expectedPnl30 ?? null,
        trackedAssetLowerPnl30: portfolio?.trackedAssetLowerPnl30 ?? null,
        returnCoverage: portfolio?.returnCoverage ?? null,
        strategy: { mode: strategy.mode, horizonYears: strategy.horizonYears },
        evidenceVersions: {
          market: marketVersion,
          assetReturn: assetReturnHealth?.generatedAt ?? null,
          eventModel: eventModelHealth?.generatedAt ?? null,
        },
      },
      thesis: `Acquire ${strategyIncoming.map((asset) => asset.name).join(' + ')} for ${strategyOutgoing.map((asset) => asset.name).join(' + ')}. Current composite net is ${marketNetToMe >= 0 ? '+' : ''}${marketNetToMe.toFixed(0)}; the ${strategy.horizonYears}-year ${strategy.mode} facts and every missing evidence lane are preserved in this snapshot.`,
      holdPeriod: portfolio?.expectedPnl30 === null || portfolio?.expectedPnl30 === undefined ? 'Reassess at 30, 90, and 180 days.' : '30–90 days for the promoted return thesis; reassess before treating it as a long-term hold.',
      exitCondition: 'Exit or reprice if role, liquidity, downside, or the declared rebuild-window thesis breaks.',
      catalysts,
    } satisfies TradeDecisionDraft
  })() : null

  const toggle = (ids: string[], setIds: (value: string[]) => void, id: string) => {
    setIds(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])
  }

  const runTapeRefresh = async () => {
    if (tapeRefreshing) return
    setTapeRefreshing(true)
    setTapeError(null)
    try {
      setTape(await refreshTradeTape())
    } catch (refreshError) {
      setTapeError(refreshError instanceof Error ? refreshError.message : 'Tape refresh failed')
      void fetchTradeTapeState().then(setTape).catch(() => undefined)
    } finally {
      setTapeRefreshing(false)
    }
  }

  return (
    <main className="page-shell trade-page">
      <section className="page-intro trade-intro">
        <div>
          <span className="eyebrow accent-eyebrow">Trade laboratory</span>
          <h1>Compare the evidence.<br />Make your own call.</h1>
          <p>Build any multi-asset package. Current prices, source disagreement, pick ranges, covered production, and your declared horizon stay separate—without a manufactured grade or resale promise.</p>
        </div>
        <div className="trade-scenario-controls">
          <div className="live-value-chip"><span /> Daily market values</div>
          <label><small>My objective</small><select value={strategy.mode === 'neutral' ? 'auto' : strategy.mode} onChange={(event) => {
            const mode = event.target.value as TeamStrategyProfile['mode']
            onStrategyChange({
              mode,
              horizonYears: mode === 'rebuilding' ? 3 : mode === 'retooling' ? 2 : mode === 'contender' ? 1 : strategy.horizonYears,
              flipPriority: 0,
            })
          }}><option value="auto">Unspecified</option><option value="rebuilding">Rebuild</option><option value="retooling">Retool</option><option value="contender">Contend</option></select></label>
          <label><small>Scenario horizon</small><select value={strategy.horizonYears} onChange={(event) => onStrategyChange({
            mode: strategy.mode === 'neutral' ? 'auto' : strategy.mode,
            horizonYears: Number(event.target.value) as TeamStrategyProfile['horizonYears'],
            flipPriority: 0,
          })}><option value={1}>1 year</option><option value={2}>2 years</option><option value={3}>3 years</option><option value={4}>4+ years</option></select></label>
        </div>
      </section>

      <div className="league-context-note panel"><span><strong>{leagueContext.label}</strong> · {leagueContext.labels.format}</span><small>Lineup legality uses {leagueContext.roster.skillStartingSlots} skill starters. Market prices use the broader {leagueContext.labels.market}, so 0.5 and 0.75 TEP are not presented as exact provider distinctions.</small></div>
      {privateStrategy && <div className={`league-context-note power-trade-gate panel policy-${privateDecision?.status ?? 'idle'}`}>
        <span><strong>{privateStrategy.kind === 'power-climb' ? 'Private power gate' : 'BC value-build guard'}</strong> · {privateStrategy.kind === 'power-climb' ? `+${privateStrategy.minimumMeaningfulPowerGain} minimum · +${privateStrategy.idealPowerGain} ideal` : 'market · current power · draft liquidity · live role'}</span>
        <small>{!strategyTeam
          ? 'Put your saved roster on either side to apply its private policy.'
          : privateDecision
            ? <><b>{privateDecision.title}.</b> {privateDecision.summary} {privateDecision.reasons.join(' ')}</>
            : 'Build both sides to test the package against the declared league policy.'}</small>
      </div>}

      <section className="trade-builder">
        <TradeSide
          side="A"
          team={teamA}
          teams={teams.filter((team) => team.rosterId !== teamBId)}
          selectedIds={selectedA}
          search={searchA}
          onSearch={setSearchA}
          onTeamChange={(id) => { setTeamAId(id); setSelectedA([]) }}
          onToggle={(id) => toggle(selectedA, setSelectedA, id)}
        />
        <TradeVerdict teamA={teamA} teamB={teamB} result={result} ready={ready} leagueContext={leagueContext} />
        <TradeSide
          side="B"
          team={teamB}
          teams={teams.filter((team) => team.rosterId !== teamAId)}
          selectedIds={selectedB}
          search={searchB}
          onSearch={setSearchB}
          onTeamChange={(id) => { setTeamBId(id); setSelectedB([]) }}
          onToggle={(id) => toggle(selectedB, setSelectedB, id)}
        />
      </section>

      <RosterImpact teamA={teamA} teamB={teamB} sideA={assetsA} sideB={assetsB} result={result} horizonYears={strategy.horizonYears} />
      {portfolio && strategyTeam && <RebuildPortfolioPanel portfolio={portfolio} team={strategyTeam} incoming={strategyIncoming} bundle={assetReturnHealth} numQbs={leagueContext.marketFormat.numQbs} horizonYears={strategy.horizonYears} />}
      {ready && strategyTeam && <CatalystTimingPanel read={catalystRead} />}
      <PickOpportunityPanel reads={pickOpportunityReads} />
      {decisionDraft && <DecisionJournalPanel key={`${decisionDraft.counterpartRosterId}:${decisionDraft.send.map((asset) => asset.id).join('+')}:${decisionDraft.receive.map((asset) => asset.id).join('+')}`} draft={decisionDraft} />}
      <PremiumModelPanel structure={structure} health={tradeModelHealth} weights={weights} weighted={weighted} onWeightsChange={setWeights} onWeightsCommit={onTradeModelWeightsChange} tape={tape} tapeRefreshing={tapeRefreshing} tapeError={tapeError} onTapeRefresh={() => void runTapeRefresh()} />
      {ready && <ScenarioPanel result={result} teamA={teamA} strategy={strategy} strategyRosterId={strategyRosterId} />}
    </main>
  )
}
