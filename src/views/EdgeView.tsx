import { AlertTriangle, ArrowLeftRight, BookOpen, Check, ChevronRight, Clock3, Info, LockKeyhole, Radar, RefreshCw, Target } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchEdgeState, fetchIntel, fetchResearchState, saveMarketTape } from '../api'
import { marketTapeLeagueContext } from '../league-context'
import type { LeagueContext } from '../league-context'
import { buildEdgeBoard, marketTapeAssets } from '../edge'
import type { EdgeCategory, TeamDirection, TeamDirectionOverride } from '../edge'
import { buildMarketDislocations } from '../dislocations'
import type { MarketDislocation } from '../dislocations'
import { emptyShadowHealth } from '../edge-learning'
import { buildIntelSignals } from '../intel'
import { journalTradeSides, tradePartyNames } from '../journal'
import type { ManagerProfile } from '../negotiation'
import type { ResearchPipelineBundle } from '../research'
import { findComparablePackages, findTradeFrontier, resolveTeamStrategy } from '../strategy'
import type { EdgeStateBundle, IntelFeed, JournalBundle, LeaguePreferences, Team, ValueBundle } from '../types'
import { AssetBadge, formatResearchGate, formatValue, signedPercent } from '../components/domain-ui'
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

export function EdgeView({
  teams,
  profiles,
  directions,
  myRosterId,
  rosterPositions,
  valueBundle,
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
  const teamStrategy = useMemo(
    () => resolveTeamStrategy(myTeam, preferences.settings.teamStrategy),
    [myTeam, preferences.settings.teamStrategy],
  )

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
    }) : [],
    [teams, myRosterId, rosterPositions, selected, teamStrategy],
  )
  const tradeFrontier = useMemo(
    () => findTradeFrontier(teams, { myRosterId, rosterPositions, strategy: teamStrategy }, 8),
    [teams, myRosterId, rosterPositions, teamStrategy],
  )
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

      <section className="trade-frontier-board panel">
        <div className="panel-heading">
          <div><span className="eyebrow">League-wide Pareto discovery</span><h2>{teamStrategy.mode === 'rebuilding' ? 'Rebuild trade frontier' : 'Trade frontier'}</h2></div>
          <span className="method-note">No weighted score</span>
        </div>
        <div className="package-evidence-banner"><Info size={16} /><span>Each priced league target is paired with the closest one-to-three-asset package from up to your 50 highest-priced assets. These options are not clearly beaten across the visible market, lineup-coverage, and declared-window facts; display order is only a tie-break.</span></div>
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
                <span><small>Lineup</small><b>{candidate.lineupDeltaMe === null ? `Guarded · ${candidate.lineupCoveragePercent}%` : `${candidate.lineupDeltaMe >= 0 ? '+' : ''}${candidate.lineupDeltaMe.toFixed(1)} PPG`}</b></span>
                <span><small>Pick-value net</small><b>{candidate.draftCapitalNetToMe >= 0 ? '+' : ''}{formatValue(candidate.draftCapitalNetToMe)}</b></span>
              </div>
              <button type="button" onClick={() => onOpenTrade({
                teamAId: myRosterId,
                teamBId: candidate.counterpartRosterId,
                selectedA: candidate.send.map((asset) => asset.id),
                selectedB: candidate.receive.map((asset) => asset.id),
              })}>Open scenarios <ChevronRight size={14} /></button>
            </article>
          )) : <div className="intel-empty"><Target size={22} /><strong>No complete frontier is available.</strong><span>Priced assets or outgoing package evidence is missing.</span></div>}
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
                <span className="edge-score"><strong>{opportunity.asset.projectedPpg === undefined ? '—' : opportunity.asset.projectedPpg.toFixed(1)}</strong><small>modeled PPG</small></span>
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
            <div><small>Age now</small><strong>{selected.asset.age ?? 'Unavailable'}</strong></div>
            <div><small>Age in {teamStrategy.horizonYears} years</small><strong>{selected.asset.age === null || selected.asset.age === undefined ? 'Unavailable' : selected.asset.age + teamStrategy.horizonYears}</strong></div>
          </div>
          <div className="edge-thesis"><small>Observed market and production</small><p>{selected.thesis}</p><small>Unvalidated news watch</small><p>{selected.catalyst} News does not change this board's order or price.</p><small>Historical return estimate</small><p>Unavailable until the market tape has enough time-separated observations in this league format.</p></div>
          <div className="edge-owner-control">
            <div><small>Owner context</small><strong>{selected.direction.label} · {selected.direction.manual ? 'manual' : 'neutral'}</strong><small>{selectedProfile?.tradeCount ?? 0} completed trades in profile</small></div>
            <select aria-label={`Direction override for ${selected.owner.teamName}`} value={preferences.settings.teamDirectionOverrides?.[String(selected.owner.rosterId)] ?? 'auto'} onChange={(event) => setDirectionOverride(selected.owner.rosterId, event.target.value as 'auto' | TeamDirectionOverride)}>
              <option value="auto">No manager label</option><option value="contender">Manual contender</option><option value="retooling">Manual retooling</option><option value="rebuilding">Manual rebuilding</option>
            </select>
          </div>
          <div className="model-caveat"><Info size={17} /><span>RosterLab has no calibrated exit value or manager-acceptance model yet. It will not invent one.</span></div>
        </aside>}
      </section>

      {selected && <section className="package-board panel edge-packages" id="target-package-frontier">
        <div className="panel-heading"><div><span className="eyebrow">Target package frontier</span><h2>Concrete packages for {selected.asset.name}</h2></div><span className="method-note">Visible tradeoffs only</span></div>
        <div className="package-evidence-banner"><Info size={16} /><span>Pareto options come first among the 60 closest packages built from up to your 50 highest-priced assets. Your declared window can protect draft capital and expose older outgoing players, but no learned age curve, news score, or acceptance probability is hidden inside the order.</span></div>
        {comparablePackages.length ? comparablePackages.map((candidate, index) => {
          const target = candidate.receive[0]
          const horizonAge = target.kind === 'player' && target.age !== null && target.age !== undefined
            ? target.age + teamStrategy.horizonYears
            : null
          return (
            <article className="package-row factual-package" key={candidate.key}>
              <span className={`stage-label ${candidate.frontier ? 'frontier-stage' : ''}`}>{candidate.frontier ? 'Pareto' : `Compare #${index + 1}`}</span>
              <div><small>You send · {formatValue(candidate.sendValue)}</small><strong>{candidate.send.map((asset) => asset.name).join(' + ')}</strong></div>
              <ArrowLeftRight size={18} />
              <div><small>You receive · {formatValue(candidate.receiveValue)}</small><strong>{candidate.receive.map((asset) => asset.name).join(' + ')}</strong></div>
              <div className="package-scores">
                <span>Market net to you<b className={candidate.marketNetToMe >= 0 ? 'positive' : 'negative'}>{candidate.marketNetToMe >= 0 ? '+' : ''}{formatValue(candidate.marketNetToMe)}</b></span>
                <span>Your lineup<b>{candidate.lineupDeltaMe === null ? 'Not covered' : `${candidate.lineupDeltaMe >= 0 ? '+' : ''}${candidate.lineupDeltaMe.toFixed(1)} PPG`}</b></span>
                <span>Their lineup<b>{candidate.lineupDeltaThem === null ? 'Not covered' : `${candidate.lineupDeltaThem >= 0 ? '+' : ''}${candidate.lineupDeltaThem.toFixed(1)} PPG`}</b></span>
                <span>Window fact<b>{target.kind === 'pick' ? 'Draft capital' : horizonAge === null ? 'Age unavailable' : `Age ${horizonAge.toFixed(1)}`}</b></span>
              </div>
              <div className="package-actions">
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
        <div className="model-caveat"><Info size={17} /><span>These packages answer “what is close in today’s market?” They do not answer “will the manager accept?” or “will this asset appreciate?” Those remain shadow-model questions until their time-split gates pass.</span></div>
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
