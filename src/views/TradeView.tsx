import { AlertTriangle, ArrowLeftRight, Check, Info, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { LeagueContext } from '../league-context'
import { assetRoleLabel, evaluateTrade, optimizeLineup, projectedLineupPpg } from '../rankings'
import type { ResolvedTeamStrategy } from '../strategy'
import type { Asset, Team, TeamStrategyProfile } from '../types'
import {
  buildConsolidationStructure,
  DEFAULT_TRADE_MODEL_WEIGHTS,
  modelSignalsForTrade,
  weightTradeEvidence,
  type ConsolidationStructure,
  type TradeModelHealthBundle,
  type TradeModelWeights,
  type WeightedTradeEvidence,
} from '../trade-models'
import { AssetBadge, Avatar, formatValue } from '../components/domain-ui'
import type { TradeDraft } from './types'

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
          <span><small>Production coverage</small><b>{result.projectionCoverage}%</b></span>
          <span><small>Side A modeled lineup</small><b>{result.lineupImpactA === null ? 'Not available' : `${result.lineupImpactA >= 0 ? '+' : ''}${result.lineupImpactA.toFixed(1)}`}</b></span>
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
  const sourceCoverage = Math.min(result.packageA.providerCoveragePercent, result.packageB.providerCoveragePercent)
  const providerTotalsApplicable = result.packageA.providerTotalsApplicable && result.packageB.providerTotalsApplicable
  const objectiveApplies = teamA.rosterId === strategyRosterId

  return (
    <section className="scenario-panel panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Honest scenario simulator</span><h2>Four lenses, no blended grade</h2></div>
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
          <small>Production range</small>
          <strong>{production?.complete ? 'Likely lineup covered' : 'Lineup result guarded'}</strong>
          <span>Floor <b>{signed(production?.floorDelta ?? null, ' PPG', true)}</b></span>
          <span>Expected <b>{signed(production?.expectedDelta ?? null, ' PPG', true)}</b></span>
          <span>Ceiling <b>{signed(production?.ceilingDelta ?? null, ' PPG', true)}</b></span>
          {production && <em>{production.beforeCoverage.covered}/{production.beforeCoverage.required} slots before · {production.afterCoverage.covered}/{production.afterCoverage.required} after</em>}
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
          ? `Side A is your saved team, so the ${strategy.mode} objective is shown as explicit horizon facts. No age-decay or resale curve is invented.`
          : `Your saved strategy belongs to another roster. This deal keeps the ${strategy.horizonYears}-year age facts visible but does not label either side as your rebuild.`}</span>
      </div>
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
}: {
  structure: ConsolidationStructure | null
  health: TradeModelHealthBundle | null
  weights: TradeModelWeights
  weighted: WeightedTradeEvidence
  onWeightsChange: (weights: TradeModelWeights) => void
  onWeightsCommit: (weights: TradeModelWeights) => void
}) {
  const exchange = health?.exchange
  const outcome = health?.outcomes.find((item) => item.horizonDays === weights.outcomeHorizon)
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
  return (
    <section className="premium-model-panel panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Consolidation research</span><h2>Raw price, exchange premium, and outcome stay separate</h2></div>
        <span className="method-note">Your weights · no automatic grade</span>
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
          <small>Exchange tape</small>
          <strong>{exchange ? `${exchange.status} · ${exchange.rows} trades` : 'Unavailable'}</strong>
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
              <span><strong>{key === 'exchange' ? 'Exchange premium' : key === 'outcome' ? 'Future outcome' : key[0].toUpperCase() + key.slice(1)}</strong><b>{weights[key]}</b></span>
              <input type="range" min="0" max="100" value={weights[key]} onChange={(event) => setWeight(key, Number(event.target.value))} onPointerUp={(event) => commitWeight(key, Number(event.currentTarget.value))} onKeyUp={(event) => commitWeight(key, Number(event.currentTarget.value))} />
              <small>{contribution?.signal === null ? 'Not promoted' : `${contribution?.signal && contribution.signal >= 0 ? '+' : ''}${contribution?.signal?.toFixed(1)}% Side A signal`}</small>
            </label>
          )
        })}
        <label className="trade-weight-select"><span><strong>Outcome horizon</strong></span><select value={weights.outcomeHorizon} onChange={(event) => setOutcomeSetting('outcomeHorizon', Number(event.target.value) as 90 | 180 | 365)}><option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>365 days</option></select><small>Held-out horizon</small></label>
        <label className="trade-weight-select"><span><strong>Outcome model</strong></span><select value={weights.outcomeVariant} onChange={(event) => setOutcomeSetting('outcomeVariant', event.target.value as TradeModelWeights['outcomeVariant'])}><option value="structureOnly">Without paid premium</option><option value="premiumAware">With paid premium</option></select><small>Compare challengers</small></label>
      </div>
      <div className="model-note premium-model-note"><Info size={16} /><span>Accepted trades reveal exchange prices, not rejected offers or acceptance probability. QB format is matched, but historical PPR/TEP/team-count values and full rosters are unavailable, so those gates remain blocked.</span></div>
    </section>
  )
}

export function TradeView({
  teams,
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
}: {
  teams: Team[]
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
}) {
  const [teamAId, setTeamAId] = useState(initialDraft?.teamAId ?? strategyRosterId)
  const [teamBId, setTeamBId] = useState(initialDraft?.teamBId ?? teams[1]?.rosterId ?? teams[0].rosterId)
  const [selectedA, setSelectedA] = useState<string[]>(initialDraft?.selectedA ?? [])
  const [selectedB, setSelectedB] = useState<string[]>(initialDraft?.selectedB ?? [])
  const [searchA, setSearchA] = useState('')
  const [searchB, setSearchB] = useState('')
  const [weights, setWeights] = useState<TradeModelWeights>(() => ({ ...DEFAULT_TRADE_MODEL_WEIGHTS, ...(tradeModelWeights ?? {}) }))
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

  const toggle = (ids: string[], setIds: (value: string[]) => void, id: string) => {
    setIds(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])
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
      {ready && <PremiumModelPanel structure={structure} health={tradeModelHealth} weights={weights} weighted={weighted} onWeightsChange={setWeights} onWeightsCommit={onTradeModelWeightsChange} />}
      {ready && <ScenarioPanel result={result} teamA={teamA} strategy={strategy} strategyRosterId={strategyRosterId} />}
    </main>
  )
}
