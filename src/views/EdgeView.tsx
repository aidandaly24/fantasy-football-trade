import { AlertTriangle, ArrowLeftRight, BookOpen, Check, ChevronRight, Clock3, Info, LockKeyhole, Radar, RefreshCw, Target } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchEdgeState, fetchIntel, fetchResearchState, saveMarketTape } from '../api'
import { marketTapeLeagueContext } from '../league-context'
import type { LeagueContext } from '../league-context'
import { evaluateLeagueTradePolicy, strategyProfileForLeague } from '../leagues'
import { TeamStrategyPlan } from '../leagues/TeamStrategyPlan'
import { buildEdgeBoard, marketTapeAssets } from '../edge'
import type { EdgeCategory, TeamDirection, TeamDirectionOverride } from '../edge'
import { buildMarketDislocations } from '../dislocations'
import type { MarketDislocation } from '../dislocations'
import { emptyShadowHealth } from '../edge-learning'
import { buildIntelSignals } from '../intel'
import { journalTradeSides, tradePartyNames } from '../journal'
import type { ManagerProfile } from '../negotiation'
import type { ResearchPipelineBundle } from '../research'
import { buildActionableTradeBook } from '../actionable-targets'
import type { ActionableTargetBook } from '../actionable-targets'
import { buildCounterpartyNegotiationBook } from '../counterparty-utility'
import { buildNegotiationLadder, buildTradeDiscovery, findComparablePackages, resolveTeamStrategy } from '../strategy'
import type { AssetReturnHealthBundle } from '../asset-returns'
import { currentSeasonLineup } from '../team-power'
import type { EdgeStateBundle, IntelFeed, JournalBundle, LeaguePreferences, Team, ValueBundle } from '../types'
import { AssetBadge, formatResearchGate, formatValue, signedPercent } from '../components/domain-ui'
import { AssetResearchPanel } from '../components/AssetResearchPanel'
import { DislocationBoard } from './DislocationBoard'
import type { TradeDraft } from './types'

function emptyEdgeState(): EdgeStateBundle {
  return {
    marketTape: {
      snapshotCount: 0, assetsTracked: 0, firstSnapshotAt: null, lastSnapshotAt: null,
      spanDays: 0, labeledExamples: 0, lastAutomaticRefreshAt: null,
      automaticRefreshError: null,
    },
    calibration: [],
    shadowModel: emptyShadowHealth(),
    shadowPredictions: [],
    historicalTape: {
      provider: 'tradyr', status: 'not-started', formatKey: 'tradyr-default-history',
      queuedAt: null, updatedAt: null, completedAt: null, targetAssets: 0, attemptedAssets: 0,
      coveredAssets: 0, missingAssets: 0, failedAssets: 0, observationCount: 0, labelCount: 0,
      coverageRate: 0, medianObservations: 0, medianSpanDays: 0, medianGapDays: 0,
      scaleCompatibleRate: 0, sourceRelativeReady: false, liveScaleReady: false, featureReady: false, gates: [],
      notes: ['The audit starts automatically after this league seeds its private market tape.'],
    },
  }
}

function actionableBookLabel(book: ActionableTargetBook): string {
  if (book === 'long-term-compounder') return 'Compounder'
  if (book === 'catalyst-flip') return 'Catalyst flip'
  return 'Liquidity conversion'
}

export function EdgeView({
  teams,
  profiles,
  directions,
  myRosterId,
  rosterPositions,
  valueBundle,
  assetReturnHealth,
  journal,
  preferences,
  leagueContext,
  onUpdatePreferences,
  onOpenTrade,
  journalSyncing,
  onSyncJournal,
  onOpenJournal,
}: {
  teams: Team[]
  profiles: ManagerProfile[]
  directions: TeamDirection[]
  myRosterId: number
  rosterPositions: string[]
  valueBundle: ValueBundle
  assetReturnHealth: AssetReturnHealthBundle | null
  journal: JournalBundle
  preferences: LeaguePreferences
  leagueContext: LeagueContext
  onUpdatePreferences: (patch: Partial<LeaguePreferences>) => void
  onOpenTrade: (draft: Omit<TradeDraft, 'nonce'>) => void
  journalSyncing: boolean
  onSyncJournal: () => void
  onOpenJournal: () => void
}) {
  const [feed, setFeed] = useState<IntelFeed | null>(null)
  const [intelLoaded, setIntelLoaded] = useState(false)
  const [edgeState, setEdgeState] = useState<EdgeStateBundle>(emptyEdgeState)
  const [research, setResearch] = useState<ResearchPipelineBundle | null>(null)
  const [edgeError, setEdgeError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | EdgeCategory>(preferences.settings.edgeFilter === 'flip' ? 'all' : preferences.settings.edgeFilter ?? 'all')
  const [selectedKey, setSelectedKey] = useState('')
  const tapeDigest = useRef('')
  const myTeam = teams.find((team) => team.rosterId === myRosterId) ?? teams[0]
  const privateStrategy = strategyProfileForLeague(leagueContext.id, myRosterId)
  const configuredStrategy = preferences.settings.teamStrategy
  const effectiveStrategy = privateStrategy?.kind === 'value-build' && (!configuredStrategy || configuredStrategy.mode === 'auto')
    ? privateStrategy.declaredStrategy
    : configuredStrategy
  const teamStrategy = useMemo(
    () => resolveTeamStrategy(myTeam, effectiveStrategy),
    [effectiveStrategy, myTeam],
  )
  const currentPowerReady = currentSeasonLineup(myTeam.players, rosterPositions).complete

  useEffect(() => {
    let active = true
    void fetchIntel().then((result) => { if (active) setFeed(result) }).catch((error) => {
      if (active) setEdgeError(error instanceof Error ? error.message : 'Intel unavailable')
    }).finally(() => { if (active) setIntelLoaded(true) })
    void fetchEdgeState(preferences.leagueId).then((result) => { if (active) setEdgeState(result) }).catch((error) => {
      if (active) setEdgeError(error instanceof Error ? error.message : 'Private edge history unavailable')
    })
    void fetchResearchState(preferences.leagueId, false).then((result) => { if (active) setResearch(result) }).catch((error) => {
      if (active) setEdgeError(error instanceof Error ? error.message : 'Historical research pipeline unavailable')
    })
    return () => { active = false }
  }, [preferences.leagueId])

  const signals = useMemo(
    () => feed ? buildIntelSignals(feed, valueBundle.players, teams, myRosterId) : [],
    [feed, myRosterId, teams, valueBundle.players],
  )
  const allOpportunities = useMemo(
    () => buildEdgeBoard(teams, { myRosterId, rosterPositions, directions, intelSignals: signals, maxResults: 500 }),
    [teams, myRosterId, rosterPositions, directions, signals],
  )
  const opportunities = allOpportunities.slice(0, 24)
  const filtered = opportunities.filter((opportunity) => filter === 'all' || opportunity.categories.includes(filter))
  const selected = opportunities.find((opportunity) => opportunity.key === selectedKey) ?? filtered[0] ?? opportunities[0]
  const selectedProfile = profiles.find((profile) => profile.rosterId === selected?.owner.rosterId)
  const selectedValue = selected?.asset.kind === 'player'
    ? valueBundle.players.find((player) => player.sleeperId === selected.asset.id)
    : null
  const comparablePackages = useMemo(
    () => selected ? findComparablePackages(teams, {
      myRosterId,
      counterpartRosterId: selected.owner.rosterId,
      rosterPositions,
      targetAssetId: selected.asset.id,
      strategy: teamStrategy,
      assetReturnHealth,
      numQbs: leagueContext.marketFormat.numQbs,
    }) : [],
    [teams, myRosterId, rosterPositions, selected, teamStrategy, assetReturnHealth, leagueContext.marketFormat.numQbs],
  )
  const negotiationLadder = useMemo(() => buildNegotiationLadder(comparablePackages), [comparablePackages])
  const negotiationStages = useMemo(
    () => new Map(negotiationLadder.map((step) => [step.package.key, step])),
    [negotiationLadder],
  )
  const counterpartyBook = useMemo(
    () => selected ? buildCounterpartyNegotiationBook({
      teams,
      myRosterId,
      counterpartRosterId: selected.owner.rosterId,
      target: selected.asset,
      packages: comparablePackages,
      profile: selectedProfile,
    }) : null,
    [teams, myRosterId, selected, comparablePackages, selectedProfile],
  )
  const counterpartyStages = useMemo(
    () => new Map(counterpartyBook?.stages.map((stage) => [stage.package.key, stage]) ?? []),
    [counterpartyBook],
  )
  const tradeDiscovery = useMemo(
    () => buildTradeDiscovery(teams, { myRosterId, rosterPositions, strategy: teamStrategy, assetReturnHealth, numQbs: leagueContext.marketFormat.numQbs }, 16),
    [teams, myRosterId, rosterPositions, teamStrategy, assetReturnHealth, leagueContext.marketFormat.numQbs],
  )
  const allTradeFrontier = tradeDiscovery.frontier
  const actionableTradeBook = useMemo(
    () => buildActionableTradeBook({
      teams,
      myRosterId,
      strategy: teamStrategy,
      assetReturnHealth,
      numQbs: leagueContext.marketFormat.numQbs,
      candidates: tradeDiscovery.candidates,
      limit: 8,
    }),
    [teams, myRosterId, teamStrategy, assetReturnHealth, leagueContext.marketFormat.numQbs, tradeDiscovery.candidates],
  )
  const actionableTargets = privateStrategy?.kind === 'power-climb'
    ? currentPowerReady
      ? actionableTradeBook.candidates.filter((candidate) => evaluateLeagueTradePolicy(privateStrategy, {
        marketNetToMe: candidate.marketNetToMe,
        currentSeasonPowerDelta: candidate.currentSeasonPowerDeltaMe,
        outgoing: candidate.send,
        incoming: candidate.receive,
      }).status === 'pass').slice(0, 5)
      : []
    : privateStrategy?.kind === 'value-build'
      ? actionableTradeBook.candidates.filter((candidate) => evaluateLeagueTradePolicy(privateStrategy, {
        marketNetToMe: candidate.marketNetToMe,
        currentSeasonPowerDelta: candidate.currentSeasonPowerDeltaMe,
        outgoing: candidate.send,
        incoming: candidate.receive,
      }).status !== 'block').slice(0, 5)
      : actionableTradeBook.candidates.slice(0, 5)
  const tradeFrontier = privateStrategy?.kind === 'power-climb'
    ? currentPowerReady
      ? allTradeFrontier.filter((candidate) => evaluateLeagueTradePolicy(privateStrategy, {
        marketNetToMe: candidate.marketNetToMe,
        currentSeasonPowerDelta: candidate.currentSeasonPowerDeltaMe,
        outgoing: candidate.send,
        incoming: candidate.receive,
      }).status === 'pass').slice(0, 8)
      : []
    : privateStrategy?.kind === 'value-build'
      ? allTradeFrontier.filter((candidate) => evaluateLeagueTradePolicy(privateStrategy, {
        marketNetToMe: candidate.marketNetToMe,
        currentSeasonPowerDelta: candidate.currentSeasonPowerDeltaMe,
        outgoing: candidate.send,
        incoming: candidate.receive,
      }).status !== 'block').slice(0, 8)
      : allTradeFrontier.slice(0, 8)
  const dislocations = useMemo(
    () => buildMarketDislocations(teams, { myRosterId, rosterPositions, directions, strategy: teamStrategy }),
    [teams, myRosterId, rosterPositions, directions, teamStrategy],
  )

  useEffect(() => {
    if (selected && selected.key !== selectedKey && !opportunities.some((opportunity) => opportunity.key === selectedKey)) {
      setSelectedKey(selected.key)
    }
  }, [selected, selectedKey, opportunities])

  const tapeAssets = useMemo(
    () => marketTapeAssets(teams, allOpportunities, teamStrategy),
    [teams, allOpportunities, teamStrategy],
  )
  const marketDigest = `${leagueContext.contextKey}:${new Date().toISOString().slice(0, 10)}:${valueBundle.meta.generatedAt}:${tapeAssets.length}:${tapeAssets.reduce((sum, asset) => sum + asset.currentValue, 0)}`
  useEffect(() => {
    if (!intelLoaded || !tapeAssets.length || tapeDigest.current === marketDigest) return
    tapeDigest.current = marketDigest
    void saveMarketTape(preferences.leagueId, {
      assets: tapeAssets,
      format: leagueContext.marketFormat,
      leagueContext: marketTapeLeagueContext(leagueContext),
      sourceVersion: valueBundle.meta.generatedAt,
    }).then(setEdgeState).catch((error) => {
      setEdgeError(error instanceof Error ? error.message : 'Could not update the private market tape')
    })
  }, [intelLoaded, leagueContext, marketDigest, preferences.leagueId, tapeAssets, valueBundle.meta.generatedAt])

  const setDirectionOverride = (rosterId: number, value: 'auto' | TeamDirectionOverride) => {
    const overrides = { ...(preferences.settings.teamDirectionOverrides ?? {}) }
    if (value === 'auto') delete overrides[String(rosterId)]
    else overrides[String(rosterId)] = value
    onUpdatePreferences({ settings: { teamDirectionOverrides: overrides } })
  }

  const inspectDislocation = (candidate: MarketDislocation) => {
    setSelectedKey(candidate.key)
    window.requestAnimationFrame(() => document.getElementById('target-package-frontier')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const completedTradeChecks = journal.outcomes.filter((outcome) => outcome.status === 'complete').length
  const playerNames = useMemo(
    () => new Map(valueBundle.players.flatMap((player) => player.sleeperId ? [[player.sleeperId, player.name] as const] : [])),
    [valueBundle.players],
  )
  const recentTrades = journal.trades.slice(0, 6)
  const shadowGatesPassed = edgeState.shadowModel.gates.filter((gate) => gate.passed).length
  const shadowStatus = edgeState.shadowModel.status === 'passed-shadow'
    ? 'Passed shadow gates'
    : edgeState.shadowModel.status === 'shadow'
      ? 'Shadow evaluation'
      : 'Collecting labels'
  const historicalStatus = edgeState.historicalTape.status === 'passed'
    ? 'History cleared every gate'
    : edgeState.historicalTape.status === 'blocked'
      ? 'History isolated by audit'
      : edgeState.historicalTape.status === 'running'
        ? `Auditing ${edgeState.historicalTape.attemptedAssets}/${edgeState.historicalTape.targetAssets}`
        : edgeState.historicalTape.status === 'queued'
          ? 'Historical audit queued'
          : edgeState.historicalTape.status === 'failed'
            ? 'Historical audit needs retry'
            : 'Waiting for market seed'

  return (
    <main className="page-shell edge-page">
      <section className="edge-hero">
        <div>
          <span className="eyebrow accent-eyebrow">Private trade discovery</span>
          <h1>Find targets.<br />Compare real packages.</h1>
          <p>Your declared window is {teamStrategy.horizonYears} years and your objective is {teamStrategy.mode}. Select any league asset to compare concrete packages using current prices and covered production—without inventing a profit or acceptance score.</p>
        </div>
        <div className="private-status"><LockKeyhole size={18} /><span><strong>Private research book</strong><small>Signals, overrides, market observations, and completed-trade outcomes are isolated to your account and league.</small></span></div>
      </section>

      <div className="league-context-note panel"><span><strong>{leagueContext.label} evidence book</strong> · {leagueContext.labels.format}</span><small>Snapshots and outcomes stay isolated under this league and context fingerprint. Prices use the broad {leagueContext.labels.market}; exact TEP affects covered lineup evidence, not provider prices.</small></div>
      {privateStrategy && <TeamStrategyPlan teams={teams} rosterPositions={rosterPositions} profile={privateStrategy} />}

      <section className="edge-stats" aria-label="Edge desk status">
        <article className="panel"><small>Rostered assets</small><strong>{allOpportunities.length}</strong><span>{opportunities.filter((item) => item.intel).length} linked news watches</span></article>
        <article className="panel"><small>Market tape</small><strong>{edgeState.marketTape.assetsTracked}</strong><span>{edgeState.marketTape.snapshotCount} private observations</span></article>
        <article className="panel"><small>Temporal labels</small><strong>{edgeState.marketTape.labeledExamples}</strong><span>{edgeState.marketTape.spanDays} days observed</span></article>
        <article className="panel"><small>Completed trades</small><strong>{journal.trades.length}</strong><span>{completedTradeChecks} outcome checkpoints</span></article>
      </section>

      <section className="panel evidence-trade-tape">
        <div className="panel-heading">
          <div><span className="eyebrow">Completed league tape</span><h2>What managers actually traded</h2></div>
          <div className="evidence-trade-actions">
            <button type="button" onClick={onSyncJournal} disabled={journalSyncing}><RefreshCw size={14} className={journalSyncing ? 'spin' : ''} /> {journalSyncing ? 'Syncing…' : 'Sync Sleeper'}</button>
            <button type="button" className="secondary" onClick={onOpenJournal}><BookOpen size={14} /> Full journal</button>
          </div>
        </div>
        {journal.sync?.status === 'partial' && <div className="journal-warning evidence-trade-warning"><AlertTriangle size={15} /> Some linked-season requests failed; prior stored trades are still shown.</div>}
        <div className="evidence-trade-list">
          {recentTrades.length ? recentTrades.map((trade) => {
            const sides = journalTradeSides(trade, journal, playerNames)
            return (
              <article className="evidence-trade-row" key={`${trade.leagueId}:${trade.transactionId}`}>
                <header>
                  <span>{trade.season} · week {trade.week}</span>
                  <time>{new Date(trade.createdAtMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time>
                </header>
                <div className="evidence-trade-sides">
                  {sides.map((side) => (
                    <section key={side.rosterId}>
                      <strong>{side.teamName} received</strong>
                      <div>{side.received.length ? side.received.map((asset) => (
                        <span key={asset.key}><AssetBadge position={asset.kind === 'pick' ? 'PICK' : 'NA'} /><b>{asset.name}</b>{asset.value !== null && <em>{formatValue(asset.value)}</em>}</span>
                      )) : <span><b>No received assets resolved</b></span>}</div>
                      {side.marketNet !== null && <small className={side.marketNet >= 0 ? 'positive' : 'negative'}>{side.marketNet >= 0 ? '+' : ''}{formatValue(side.marketNet)} captured market net</small>}
                    </section>
                  ))}
                </div>
              </article>
            )
          }) : <div className="intel-empty evidence-trade-empty"><BookOpen size={22} /><strong>No completed trades loaded.</strong><span>Sleeper has a completed Week 1 trade for this league. Sync the ledger to bring it into Evidence.</span><button type="button" onClick={onSyncJournal} disabled={journalSyncing}>{journalSyncing ? 'Syncing Sleeper…' : 'Sync now'}</button></div>}
        </div>
        {journal.trades.length > recentTrades.length && <button type="button" className="evidence-trade-more" onClick={onOpenJournal}>View all {journal.trades.length} completed trades</button>}
      </section>

      <section className="learning-desk panel">
        <div className="panel-heading">
          <div><span className="eyebrow">V4.7 tape · V4.8 calibration · V4.9 shadow ML</span><h2>Evidence before promotion</h2></div>
          <span className={`learning-status learning-${edgeState.shadowModel.status}`}>{shadowStatus}</span>
        </div>
        <div className="learning-grid">
          <article><small>Daily market tape</small><strong>{edgeState.marketTape.assetsTracked} assets</strong><span>Automatic refresh continues after the league is seeded.</span></article>
          <article><small>Historical cohorts</small><strong>{edgeState.calibration.length}</strong><span>Research display only; no live price adjustment.</span></article>
          <article><small>Shadow value model</small><strong>{shadowGatesPassed}/{edgeState.shadowModel.gates.length} gates</strong><span>It cannot change rankings or prices in V4.9.</span></article>
          <article><small>Outcome checks</small><strong>{completedTradeChecks}</strong><span>Completed trades with follow-up snapshots.</span></article>
        </div>
        <div className="learning-gates">
          {edgeState.shadowModel.gates.map((gate) => <span className={gate.passed ? 'passed' : ''} key={gate.id}>{gate.passed ? <Check size={14} /> : <Clock3 size={14} />} {gate.label}: {['maeLift', 'rankGuardrail'].includes(gate.id) ? `${(gate.actual * 100).toFixed(1)}%` : gate.actual.toFixed(0)} / {gate.requirement}</span>)}
        </div>
        {edgeState.calibration.length > 0 && <div className="calibration-strip">
          {edgeState.calibration.slice(0, 4).map((group) => <article key={group.key}><small>{group.label}</small><strong>{signedPercent(group.actualReturn)}</strong><span>{group.sampleSize} observed labels · research only</span></article>)}
        </div>}
        <div className="model-caveat"><Info size={17} /><span>The shadow model is deliberately firewalled from live recommendations. It advances only after later, time-split examples beat a no-change baseline.</span></div>
        <div className="panel-heading historical-audit-heading">
          <div><span className="eyebrow">V5.0 historical tape audit</span><h2>Backfill only what survives provenance checks</h2></div>
          <span className={`learning-status learning-${edgeState.historicalTape.status}`}>{historicalStatus}</span>
        </div>
        <div className="calibration-strip historical-audit-stats">
          <article><small>Coverage</small><strong>{Math.round(edgeState.historicalTape.coverageRate * 100)}%</strong><span>{edgeState.historicalTape.coveredAssets}/{edgeState.historicalTape.targetAssets} sampled players</span></article>
          <article><small>Provider observations</small><strong>{edgeState.historicalTape.observationCount}</strong><span>{edgeState.historicalTape.labelCount} source-relative 30-day labels</span></article>
          <article><small>Median depth</small><strong>{edgeState.historicalTape.medianSpanDays}</strong><span>days · {edgeState.historicalTape.medianObservations} observations/player</span></article>
          <article><small>Scale compatible</small><strong>{Math.round(edgeState.historicalTape.scaleCompatibleRate * 100)}%</strong><span>Raw provider scales are never blended.</span></article>
        </div>
        {edgeState.historicalTape.gates.length > 0 && <div className="learning-gates">
          {edgeState.historicalTape.gates.map((gate) => <span className={gate.passed ? 'passed' : ''} key={gate.id}>{gate.passed ? <Check size={14} /> : <Clock3 size={14} />} {gate.label}: {['coverage', 'scale'].includes(gate.id) ? `${(gate.actual * 100).toFixed(0)}%` : gate.actual.toFixed(0)} / {gate.requirement}</span>)}
        </div>}
        <div className="model-caveat"><Info size={17} /><span>{edgeState.historicalTape.notes[1] ?? edgeState.historicalTape.notes[0]}</span></div>
        <div className="panel-heading historical-audit-heading">
          <div><span className="eyebrow">V5.1–V5.6 historical intelligence</span><h2>Reconstruct, join, challenge, then promote</h2></div>
          <span className="method-note">{research ? `${research.phases.filter((phase) => phase.status === 'ready' || phase.status === 'shadow').length}/6 pipelines active` : 'Loading private audit'}</span>
        </div>
        {research ? <div className="research-phase-grid">
          {research.phases.map((phase) => (
            <article className={`research-phase research-${phase.status}`} key={phase.version}>
              <header><span>V{phase.version}</span><i>{phase.status}</i></header>
              <strong>{phase.title}</strong>
              <p>{phase.summary}</p>
              <div>{phase.gates.map((gate) => <small className={gate.passed ? 'passed' : ''} key={gate.id}>{gate.passed ? <Check size={12} /> : <Clock3 size={12} />}{gate.label}: {formatResearchGate(gate)}</small>)}</div>
            </article>
          ))}
        </div> : <div className="intel-empty research-loading"><RefreshCw className="spin" size={20} /><strong>Rebuilding the historical state tape…</strong><span>The first pass follows every linked Sleeper season and then runs automatically.</span></div>}
        {research && <div className="model-caveat"><Info size={17} /><span>{research.notes[1]}</span></div>}
      </section>

      <section className="direction-tape panel">
        <div><span className="eyebrow">Team context</span><strong>Labels are context only; they do not reprice picks.</strong></div>
        <div className="direction-tape-list">
          {directions.filter((direction) => direction.rosterId !== myRosterId).map((direction) => {
            const team = teams.find((item) => item.rosterId === direction.rosterId)
            return <button type="button" key={direction.rosterId} onClick={() => {
              const first = opportunities.find((opportunity) => opportunity.owner.rosterId === direction.rosterId)
              if (first) setSelectedKey(first.key)
            }}><span className={`direction-dot direction-${direction.label}`} /><strong>{team?.teamName}</strong><small>{direction.label} · {direction.manual ? 'manual label' : 'neutral placeholder'}</small></button>
          })}
        </div>
      </section>

      <section className="edge-toolbar panel">
        <label><small>My team</small><select value={myRosterId} onChange={(event) => onUpdatePreferences({ myRosterId: Number(event.target.value) })}>{teams.map((team) => <option value={team.rosterId} key={team.rosterId}>{team.teamName}</option>)}</select></label>
        <label><small>Declared objective</small><select value={preferences.settings.teamStrategy?.mode ?? 'auto'} onChange={(event) => {
          const mode = event.target.value as 'auto' | 'contender' | 'retooling' | 'rebuilding'
          onUpdatePreferences({ settings: { teamStrategy: {
            mode,
            horizonYears: mode === 'rebuilding' ? 3 : mode === 'retooling' ? 2 : mode === 'contender' ? 1 : teamStrategy.horizonYears,
            flipPriority: 0,
          } } })
        }}><option value="auto">Unspecified · neutral</option><option value="rebuilding">Rebuild</option><option value="retooling">Retool</option><option value="contender">Contend</option></select></label>
        <label><small>Value horizon</small><select value={teamStrategy.horizonYears} onChange={(event) => onUpdatePreferences({ settings: { teamStrategy: {
          mode: preferences.settings.teamStrategy?.mode ?? (teamStrategy.mode === 'neutral' ? 'auto' : teamStrategy.mode),
          horizonYears: Number(event.target.value) as 1 | 2 | 3 | 4,
          flipPriority: 0,
        } } })}><option value={1}>1 year</option><option value={2}>2 years</option><option value={3}>3 years</option><option value={4}>4+ years</option></select></label>
        <div className="intel-tabs" role="group" aria-label="Evidence filter">
          {(['all', 'value', 'points', 'intel'] as const).map((item) => <button type="button" key={item} className={filter === item ? 'active' : ''} onClick={() => {
            setFilter(item)
            onUpdatePreferences({ settings: { edgeFilter: item } })
          }}>{item === 'all' ? 'All assets' : item === 'value' ? 'Market' : item === 'points' ? 'Production' : 'News watch'}</button>)}
        </div>
        <span>{filtered.length} assets with evidence</span>
      </section>
      {edgeError && <div className="intel-error">Private research warning: {edgeError}</div>}

      <DislocationBoard candidates={dislocations} onInspect={inspectDislocation} />

      <section className="actionable-trade-book panel">
        <div className="panel-heading">
          <div><span className="eyebrow">V7.8 actionable trade book</span><h2>Only trades with a named edge and exit</h2></div>
          <span className="method-note">Top {actionableTargets.length} · no target score</span>
        </div>
        <div className="package-evidence-banner"><Info size={16} /><span>{actionableTradeBook.method} The objective is to capture acquisition discount, supported repricing, or liquidity—not to celebrate a calculator grade after the fact.</span></div>
        {actionableTargets.length ? <div className="actionable-target-list">
          {actionableTargets.map((candidate) => (
            <article key={`actionable-${candidate.key}`}>
              <header>
                <span className={`actionable-book actionable-${candidate.book}`}>{actionableBookLabel(candidate.book)}</span>
                <small>{candidate.qualifyingBooks.length > 1 ? `${candidate.qualifyingBooks.length} supported theses` : '1 supported thesis'}</small>
              </header>
              <div className="actionable-target-name">
                <span><AssetBadge position={candidate.targetAsset.position} /><small>From {candidate.counterpartName}</small></span>
                <strong>{candidate.targetAsset.name}</strong>
                <em>{formatValue(candidate.targetAsset.value)} current composite</em>
              </div>
              <div className="actionable-package">
                <small>Opening structure to inspect</small>
                <strong>{candidate.send.map((asset) => asset.name).join(' + ')}</strong>
                <span>{formatValue(candidate.sendValue)} sent · <b className={candidate.marketNetToMe >= 0 ? 'positive' : 'negative'}>{candidate.marketNetToMe >= 0 ? '+' : ''}{formatValue(candidate.marketNetToMe)} current-market net</b></span>
              </div>
              <div className="actionable-edge-thesis">
                <span><small>Why the edge can exist</small><strong>{candidate.edgeMechanism}</strong></span>
                <span><small>Hold plan</small><strong>{candidate.holdPeriod}</strong></span>
                <span><small>Exit / failure rule</small><strong>{candidate.exitCondition}</strong></span>
              </div>
              <div className="actionable-facts">
                <span><small>30-day package P&amp;L</small><b>{candidate.portfolio?.expectedPnl30 === null || candidate.portfolio?.expectedPnl30 === undefined ? 'Unavailable' : `${candidate.portfolio.expectedPnl30 >= 0 ? '+' : ''}${candidate.portfolio.expectedPnl30.toFixed(0)} FC`}</b></span>
                <span><small>Tracked downside</small><b>{candidate.portfolio?.trackedAssetLowerPnl30 === null || candidate.portfolio?.trackedAssetLowerPnl30 === undefined ? 'Unavailable' : `${candidate.portfolio.trackedAssetLowerPnl30 >= 0 ? '+' : ''}${candidate.portfolio.trackedAssetLowerPnl30.toFixed(0)} FC`}</b></span>
                <span><small>180-day drawdown</small><b>{candidate.evidence.targetDrawdown180 === null ? 'Unavailable' : `${(candidate.evidence.targetDrawdown180 * 100).toFixed(1)}%`}</b></span>
                <span><small>Age at horizon</small><b>{candidate.evidence.targetAgeAtHorizon === null ? candidate.targetAsset.kind === 'pick' ? 'Draft capital' : 'Unavailable' : candidate.evidence.targetAgeAtHorizon.toFixed(1)}</b></span>
              </div>
              <details>
                <summary>Why it qualified</summary>
                <div>{candidate.gates.map((gate) => <span key={gate.id}><Check size={12} /><strong>{gate.label}</strong><small>{gate.observed} · {gate.requirement}</small></span>)}</div>
              </details>
              <button type="button" onClick={() => onOpenTrade({
                teamAId: myRosterId,
                teamBId: candidate.counterpartRosterId,
                selectedA: candidate.send.map((asset) => asset.id),
                selectedB: candidate.receive.map((asset) => asset.id),
              })}>Stress-test package <ChevronRight size={14} /></button>
            </article>
          ))}
        </div> : <div className="intel-empty"><Target size={22} /><strong>No target clears an actionable thesis today.</strong><span>{actionableTradeBook.evaluatedTargets ? `${actionableTradeBook.evaluatedTargets} rostered targets were checked; ${actionableTradeBook.qualifyingTargets} cleared a raw thesis before private league policy.` : 'The promoted return tape or a complete package population is unavailable.'} Holding is better than manufacturing a small-value trade.</span></div>}
        <div className="actionability-thresholds">
          <span><small>Material starter value</small><b>{formatValue(actionableTradeBook.thresholds.starterValueFloor)}</b></span>
          <span><small>Median covered liquidity</small><b>{actionableTradeBook.thresholds.liquidityFloor === null ? 'Unavailable' : actionableTradeBook.thresholds.liquidityFloor.toFixed(4)}</b></span>
          <span><small>Median tracked drawdown</small><b>{actionableTradeBook.thresholds.drawdownFloor === null ? 'Unavailable' : `${(actionableTradeBook.thresholds.drawdownFloor * 100).toFixed(1)}%`}</b></span>
          <span><small>Material positive P&amp;L</small><b>{actionableTradeBook.thresholds.catalystPnlFloor === null ? 'Unavailable' : `${actionableTradeBook.thresholds.catalystPnlFloor.toFixed(0)} FC`}</b></span>
          <span><small>Package downside floor</small><b>{actionableTradeBook.thresholds.packageDownsideFloor === null ? 'Unavailable' : `${actionableTradeBook.thresholds.packageDownsideFloor.toFixed(0)} FC`}</b></span>
        </div>
        <div className="model-caveat"><Info size={17} /><span>These gates improve selection discipline; they do not prove the seller will accept or that a target will appreciate. Negotiation utility and realized outcomes remain separate future edges.</span></div>
      </section>

      <section className="trade-frontier-board panel">
        <div className="panel-heading">
          <div><span className="eyebrow">League-wide Pareto discovery</span><h2>{privateStrategy?.kind === 'power-climb' ? 'Lineup-power trade frontier' : privateStrategy?.kind === 'value-build' ? 'BC value-build frontier' : teamStrategy.mode === 'rebuilding' ? 'Rebuild trade frontier' : 'Trade frontier'}</h2></div>
          <span className="method-note">No weighted score</span>
        </div>
        <div className="package-evidence-banner"><Info size={16} /><span>{privateStrategy?.kind === 'power-climb' ? currentPowerReady ? `Only Pareto options adding at least ${privateStrategy.minimumMeaningfulPowerGain} current-season lineup power are shown here. The ideal Phil-league move adds ${privateStrategy.idealPowerGain}; an empty result means patience, not a reason to lower the bar.` : 'The current redraft feed does not cover every legal lineup slot, so the private power frontier is guarded instead of falling back to dynasty value.' : privateStrategy?.kind === 'value-build' ? 'Pareto options use the shared evidence engine, then the BC policy removes only hard triple-loss packages. Market value, current power, draft capital, age, and covered production remain separate; review cases stay visible.' : 'Each priced league target is paired with the closest one-to-three-asset package from up to your 50 highest-priced assets. These options are not clearly beaten across the visible market, lineup-coverage, and declared-window facts; display order is only a tie-break.'}</span></div>
        <div className="trade-frontier-list">
          {tradeFrontier.length ? tradeFrontier.map((candidate) => (
            <article key={`frontier-${candidate.key}`}>
              <span className="frontier-mark">Pareto</span>
              <div className="frontier-target">
                <span><AssetBadge position={candidate.targetAsset.position} /><small>Acquire from {candidate.counterpartName}</small></span>
                <strong>{candidate.targetAsset.name}</strong>
                <em>{formatValue(candidate.receiveValue)} current composite</em>
              </div>
              <div className="frontier-send"><small>You send</small><strong>{candidate.send.map((asset) => asset.name).join(' + ')}</strong><em>{formatValue(candidate.sendValue)}</em></div>
              <div className="frontier-facts">
                <span><small>Market net</small><b className={candidate.marketNetToMe >= 0 ? 'positive' : 'negative'}>{candidate.marketNetToMe >= 0 ? '+' : ''}{formatValue(candidate.marketNetToMe)}</b></span>
                <span><small>Market distance</small><b>{(candidate.marketDistancePercent * 100).toFixed(1)}%</b></span>
                <span><small>Current power</small><b>{candidate.currentSeasonPowerDeltaMe === null ? `Guarded · ${candidate.currentSeasonCoveragePercent}%` : `${candidate.currentSeasonPowerDeltaMe >= 0 ? '+' : ''}${candidate.currentSeasonPowerDeltaMe}`}</b></span>
                <span><small>Pick-value net</small><b>{candidate.draftCapitalNetToMe >= 0 ? '+' : ''}{formatValue(candidate.draftCapitalNetToMe)}</b></span>
                <span><small>30-day return P&amp;L</small><b>{candidate.portfolio?.expectedPnl30 === null || candidate.portfolio?.expectedPnl30 === undefined ? 'Unavailable' : `${candidate.portfolio.expectedPnl30 >= 0 ? '+' : ''}${candidate.portfolio.expectedPnl30.toFixed(0)} FC`}</b></span>
              </div>
              <button type="button" onClick={() => onOpenTrade({
                teamAId: myRosterId,
                teamBId: candidate.counterpartRosterId,
                selectedA: candidate.send.map((asset) => asset.id),
                selectedB: candidate.receive.map((asset) => asset.id),
              })}>Open scenarios <ChevronRight size={14} /></button>
            </article>
          )) : <div className="intel-empty"><Target size={22} /><strong>{privateStrategy?.kind === 'power-climb' ? currentPowerReady ? 'No current package clears your power gate.' : 'The power frontier is guarded.' : privateStrategy?.kind === 'value-build' ? 'No BC package survives the value-build guard.' : 'No complete frontier is available.'}</strong><span>{privateStrategy?.kind === 'power-climb' ? currentPowerReady ? `None of the visible Pareto packages adds at least ${privateStrategy.minimumMeaningfulPowerGain} lineup-power points. Hold rather than manufacture a depth trade.` : 'Wait for complete current-season coverage; no substitute score is being manufactured.' : privateStrategy?.kind === 'value-build' ? 'Every visible Pareto package currently loses market value, current power, and a pick together. Keep the liquidity and wait for a better asymmetry.' : 'Priced assets or outgoing package evidence is missing.'}</span></div>}
        </div>
        <div className="model-caveat"><Info size={17} /><span>“Pareto” means no shown option is better on every displayed objective. It does not mean the other manager will accept, and it does not predict resale profit.</span></div>
      </section>

      <section className="edge-layout">
        <div className="edge-board panel">
          <div className="panel-heading"><div><span className="eyebrow">League-wide evidence board</span><h2>Current asset inventory</h2></div><span className="method-note">Ordered by current composite value only</span></div>
          <div className="edge-list">
            {filtered.length ? filtered.slice(0, 15).map((opportunity) => (
              <button type="button" className={`edge-row ${selected?.key === opportunity.key ? 'active' : ''}`} key={opportunity.key} onClick={() => setSelectedKey(opportunity.key)}>
                <span className="edge-rank">—</span>
                <span className="edge-player"><AssetBadge position={opportunity.asset.position} /><span><strong>{opportunity.asset.name}</strong><small>{opportunity.owner.teamName} · {opportunity.direction.label}</small></span></span>
                <span className="edge-categories">{opportunity.categories.map((category) => <i key={category}>{category}</i>)}</span>
                <span><small>Current market</small><strong>{formatValue(opportunity.asset.value)}</strong></span>
                <span><small>Age now</small><strong>{opportunity.asset.age ?? '—'}</strong></span>
                <span className="edge-score"><strong>{opportunity.asset.currentSeasonValue === undefined ? '—' : formatValue(opportunity.asset.currentSeasonValue)}</strong><small>lineup power</small></span>
                <ChevronRight size={16} />
              </button>
            )) : <div className="intel-empty"><Radar size={22} /><strong>No asset has this evidence type.</strong><span>An empty list is more honest than a manufactured edge.</span></div>}
          </div>
        </div>

        {selected && <aside className="edge-detail panel">
          <div className="edge-detail-head"><span><AssetBadge position={selected.asset.position} /><small>Evidence only · no trade score</small></span><h2>{selected.asset.name}</h2><p>{selected.owner.teamName} · {formatValue(selected.asset.value)} current composite</p></div>
          <div className="edge-price-grid">
            <div><small>KTC</small><strong>{selectedValue?.sources.ktc ? formatValue(selectedValue.sources.ktc) : 'Unavailable'}</strong></div>
            <div><small>FantasyCalc</small><strong>{selectedValue?.sources.fantasycalc ? formatValue(selectedValue.sources.fantasycalc) : 'Unavailable'}</strong></div>
            <div><small>Current-season power</small><strong>{selected.asset.currentSeasonValue === undefined ? 'Unavailable' : formatValue(selected.asset.currentSeasonValue)}</strong></div>
            <div><small>Age now</small><strong>{selected.asset.age ?? 'Unavailable'}</strong></div>
            <div><small>Age in {teamStrategy.horizonYears} years</small><strong>{selected.asset.age === null || selected.asset.age === undefined ? 'Unavailable' : selected.asset.age + teamStrategy.horizonYears}</strong></div>
          </div>
          <div className="edge-thesis"><small>Observed market and production</small><p>{selected.thesis}</p><small>Unvalidated news watch</small><p>{selected.catalyst} News does not change this board's order or price.</p></div>
          <AssetResearchPanel asset={selected.asset} bundle={assetReturnHealth} numQbs={leagueContext.marketFormat.numQbs} horizonYears={teamStrategy.horizonYears} compact />
          <div className="edge-owner-control">
            <div><small>Owner context</small><strong>{selected.direction.label} · {selected.direction.manual ? 'manual' : 'neutral'}</strong><small>{selectedProfile?.tradeCount ?? 0} completed trades in profile</small></div>
            <select aria-label={`Direction override for ${selected.owner.teamName}`} value={preferences.settings.teamDirectionOverrides?.[String(selected.owner.rosterId)] ?? 'auto'} onChange={(event) => setDirectionOverride(selected.owner.rosterId, event.target.value as 'auto' | TeamDirectionOverride)}>
              <option value="auto">No manager label</option><option value="contender">Manual contender</option><option value="retooling">Manual retooling</option><option value="rebuilding">Manual rebuilding</option>
            </select>
          </div>
          <div className="model-caveat"><Info size={17} /><span>The promoted model estimates only 30-day FantasyCalc return. RosterLab still has no calibrated long-term exit value or manager-acceptance model.</span></div>
        </aside>}
      </section>

      {selected && <section className="package-board panel edge-packages" id="target-package-frontier">
        <div className="panel-heading"><div><span className="eyebrow">Target package frontier</span><h2>Concrete packages for {selected.asset.name}</h2></div><span className="method-note">Visible tradeoffs only</span></div>
        <div className="package-evidence-banner"><Info size={16} /><span>Pareto options come first among the 60 closest packages built from up to your 50 highest-priced assets. For rebuild/retool objectives, promoted 30-day return, tracked downside, drawdown, and concentration join current price, picks, age, and production as separate objectives. No blended grade or acceptance probability is hidden inside the order.</span></div>
        {counterpartyBook && <div className="counterparty-utility-read">
          <div className="panel-heading"><div><span className="eyebrow">V7.9 counterparty utility</span><h3>Read the seller before changing the price</h3></div><span className="method-note">Whole-roster facts · no acceptance odds</span></div>
          <div className="counterparty-roster-facts">
            <article><small>League-below-median positions</small><strong>{counterpartyBook.seller.needPositions.join(' · ') || 'None'}</strong><span>Derived from current dynasty value by position</span></article>
            <article><small>League-above-median positions</small><strong>{counterpartyBook.seller.surplusPositions.join(' · ') || 'None'}</strong><span>{selected.asset.kind === 'player' && counterpartyBook.seller.surplusPositions.includes(selected.asset.position as 'QB' | 'RB' | 'WR' | 'TE') ? `${selected.asset.name} comes from one` : 'The target is not assumed expendable'}</span></article>
            <article><small>Pick inventory</small><strong>{(counterpartyBook.seller.pickValueShare * 100).toFixed(1)}% of roster value</strong><span>League median {(counterpartyBook.seller.leagueMedianPickValueShare * 100).toFixed(1)}%</span></article>
            <article><small>Completed-trade sample</small><strong>{counterpartyBook.seller.completedTradeEvidence?.tradeCount ?? 0}</strong><span>{counterpartyBook.seller.completedTradeEvidence ? `${counterpartyBook.seller.completedTradeEvidence.receivedPlayers} players · ${counterpartyBook.seller.completedTradeEvidence.receivedPicks} picks received` : 'No profile loaded'}</span></article>
          </div>
          <p>{counterpartyBook.method}</p>
        </div>}
        {comparablePackages.length ? comparablePackages.map((candidate, index) => {
          const target = candidate.receive[0]
          const negotiation = negotiationStages.get(candidate.key)
          const utility = counterpartyStages.get(candidate.key)
          const horizonAge = target.kind === 'player' && target.age !== null && target.age !== undefined
            ? target.age + teamStrategy.horizonYears
            : null
          return (
            <article className="package-row factual-package" key={candidate.key}>
              <span className={`stage-label ${candidate.frontier ? 'frontier-stage' : ''}`}>{negotiation ? negotiation.stage.replaceAll('-', ' ') : candidate.frontier ? 'Pareto' : `Compare #${index + 1}`}</span>
              <div><small>You send · {formatValue(candidate.sendValue)}</small><strong>{candidate.send.map((asset) => asset.name).join(' + ')}</strong></div>
              <ArrowLeftRight size={18} />
              <div><small>You receive · {formatValue(candidate.receiveValue)}</small><strong>{candidate.receive.map((asset) => asset.name).join(' + ')}</strong></div>
              <div className="package-scores">
                <span>Market net to you<b className={candidate.marketNetToMe >= 0 ? 'positive' : 'negative'}>{candidate.marketNetToMe >= 0 ? '+' : ''}{formatValue(candidate.marketNetToMe)}</b></span>
                <span>Your current power<b>{candidate.currentSeasonPowerDeltaMe === null ? 'Not covered' : `${candidate.currentSeasonPowerDeltaMe >= 0 ? '+' : ''}${candidate.currentSeasonPowerDeltaMe}`}</b></span>
                <span>Your modeled PPG<b>{candidate.lineupDeltaMe === null ? 'Not covered' : `${candidate.lineupDeltaMe >= 0 ? '+' : ''}${candidate.lineupDeltaMe.toFixed(1)}`}</b></span>
                <span>Window fact<b>{target.kind === 'pick' ? 'Draft capital' : horizonAge === null ? 'Age unavailable' : `Age ${horizonAge.toFixed(1)}`}</b></span>
                <span>30-day return P&amp;L<b>{candidate.portfolio?.expectedPnl30 === null || candidate.portfolio?.expectedPnl30 === undefined ? 'Unavailable' : `${candidate.portfolio.expectedPnl30 >= 0 ? '+' : ''}${candidate.portfolio.expectedPnl30.toFixed(0)} FC`}</b></span>
                <span>Tracked downside P&amp;L<b>{candidate.portfolio?.trackedAssetLowerPnl30 === null || candidate.portfolio?.trackedAssetLowerPnl30 === undefined ? 'Unavailable' : `${candidate.portfolio.trackedAssetLowerPnl30 >= 0 ? '+' : ''}${candidate.portfolio.trackedAssetLowerPnl30.toFixed(0)} FC`}</b></span>
              </div>
              <div className="package-actions">
                {negotiation && <small className="negotiation-explanation">{negotiation.explanation}</small>}
                {utility && <details className="seller-utility-details"><summary>Seller-side read</summary><div>
                  <strong>Why they might consider it</strong>
                  {utility.whyTheyMightConsider.length ? <ul>{utility.whyTheyMightConsider.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p>No positive current-roster fit is visible.</p>}
                  <strong>Objections to expect</strong>
                  {utility.blockers.length ? <ul>{utility.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p>No factual roster-fit blocker is visible.</p>}
                </div></details>}
                <button type="button" className="compare-package" onClick={() => onOpenTrade({
                  teamAId: myRosterId,
                  teamBId: selected.owner.rosterId,
                  selectedA: candidate.send.map((asset) => asset.id),
                  selectedB: candidate.receive.map((asset) => asset.id),
                })}>Compare in Trade Lab</button>
              </div>
            </article>
          )
        }) : <div className="intel-empty"><Target size={22} /><strong>No priced package is available.</strong><span>This target or your outgoing assets are missing current market values.</span></div>}
        {counterpartyBook?.threeWayBridges.length ? <div className="three-way-bridges">
          <div className="panel-heading"><div><span className="eyebrow">Bounded three-way escape hatch</span><h3>Direct packages miss the seller’s visible utility</h3></div><span className="method-note">Top {counterpartyBook.threeWayBridges.length} nearest ledgers</span></div>
          {counterpartyBook.threeWayBridges.map((bridge) => <article key={bridge.key}>
            <strong>You receive {bridge.target.name}</strong>
            <span>{selected.owner.teamName} receives {bridge.bridgeToSeller.name}</span>
            <span>{teams.find((team) => team.rosterId === bridge.thirdRosterId)?.teamName} receives {bridge.assetToThird.name}</span>
            <div>{bridge.marketLedger.map((row) => <small key={row.rosterId}>{row.teamName}: {row.net >= 0 ? '+' : ''}{formatValue(row.net)}</small>)}</div>
            <p>{bridge.evidence.join(' ')} {bridge.caveat}</p>
          </article>)}
        </div> : null}
        <div className="model-caveat"><Info size={17} /><span>The opening/target/walk-away labels are price anchors derived from this displayed package set—not acceptance odds. The return lens is a promoted 30-day estimate with tracked-asset coverage, not a guaranteed appreciation or three-year forecast.</span></div>
      </section>}

      <section className="edge-review-grid edge-review-single">
        <div className="panel attribution-book">
          <div className="panel-heading"><div><span className="eyebrow">Raw collection</span><h2>Market tape status</h2></div><span className="method-note">Observed values, not forecasts</span></div>
          <div className="intel-empty"><Clock3 size={20} /><strong>{edgeState.marketTape.snapshotCount} observations across {edgeState.marketTape.assetsTracked} assets.</strong><span>{edgeState.marketTape.spanDays} days of depth. Promotion stays blocked until later observations create real, time-separated outcome labels.</span></div>
        </div>
      </section>
    </main>
  )
}
