import { AlertTriangle, BookOpen, Info, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchTradeDecisions, updateTradeDecision } from '../api'
import type { TradeDecision, TradeDecisionStatus } from '../decision-journal'
import { timeAgo } from '../intel'
import { tradePartyNames } from '../journal'
import type { LeagueContext } from '../league-context'
import type { JournalBundle, JournalTrade } from '../types'
import { AssetBadge, formatValue } from '../components/domain-ui'

function formatForwardPnl(value: number | null | undefined, legacy: number | null): string {
  const resolved = value === undefined ? legacy : value
  return resolved === null ? 'Unavailable' : `${resolved >= 0 ? '+' : ''}${resolved.toFixed(0)} FC`
}

export function TradeJournalView({
  journal,
  syncing,
  onSync,
  leagueContext,
}: {
  journal: JournalBundle
  syncing: boolean
  onSync: () => void
  leagueContext: LeagueContext
}) {
  const seasons = [...new Set(journal.trades.map((trade) => trade.season))]
  const [season, setSeason] = useState('all')
  const [decisions, setDecisions] = useState<TradeDecision[]>([])
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [updatingDecision, setUpdatingDecision] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetchTradeDecisions(leagueContext.id).then((bundle) => {
      if (!cancelled) setDecisions(bundle.decisions)
    }).catch((error) => {
      if (!cancelled) setDecisionError(error instanceof Error ? error.message : 'Decision journal unavailable')
    })
    return () => { cancelled = true }
  }, [leagueContext.id])
  const setDecisionStatus = async (id: string, status: TradeDecisionStatus) => {
    setUpdatingDecision(id)
    setDecisionError(null)
    try {
      setDecisions((await updateTradeDecision(leagueContext.id, id, status)).decisions)
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Decision status could not be saved')
    } finally {
      setUpdatingDecision(null)
    }
  }
  const visibleTrades = journal.trades.filter((trade) => season === 'all' || trade.season === season)
  const completedOutcomes = journal.outcomes.filter((outcome) => outcome.status === 'complete').length
  const pendingOutcomes = journal.outcomes.filter((outcome) => outcome.status === 'pending' || outcome.status === 'due').length
  const coverage = journal.sync?.targetsAttempted
    ? journal.sync.targetsSucceeded / journal.sync.targetsAttempted
    : 0

  const tradeCard = (trade: JournalTrade) => {
    const names = tradePartyNames(trade, journal.identities)
    const snapshots = journal.snapshots.filter((item) => item.leagueId === trade.leagueId && item.transactionId === trade.transactionId)
    const baseline = snapshots.find((item) => item.kind === 'ingestion')
      ?? snapshots.find((item) => item.kind === 'backfill-current')
      ?? snapshots[0]
    const outcomes = journal.outcomes
      .filter((item) => item.leagueId === trade.leagueId && item.transactionId === trade.transactionId)
      .sort((a, b) => a.checkpointDays - b.checkpointDays)
    const partyIds = [...new Set(trade.raw.roster_ids)].sort((a, b) => a - b)
    return (
      <article className="journal-card panel" key={`${trade.leagueId}:${trade.transactionId}`}>
        <div className="journal-card-head">
          <div><span className="eyebrow">{trade.season} · week {trade.week}</span><h2>{partyIds.map((id) => names.get(id)).join(' ↔ ')}</h2></div>
          <time>{new Date(trade.createdAtMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time>
        </div>
        <div className="journal-parties">
          {partyIds.map((rosterId) => {
            const received = baseline?.values.assets.filter((asset) => asset.toRosterId === rosterId) ?? []
            const partyValue = baseline?.values.parties.find((party) => party.rosterId === rosterId)
            return (
              <section key={rosterId}>
                <span className="journal-team">{names.get(rosterId)}</span>
                <div className="journal-assets">
                  {received.length ? received.map((asset) => (
                    <span key={asset.key}><AssetBadge position={asset.kind === 'pick' ? 'PICK' : 'NA'} /><b>{asset.name}</b><em>{asset.value == null ? 'unpriced' : formatValue(asset.value)}</em></span>
                  )) : <span><b>Assets unavailable</b><em>source record retained</em></span>}
                </div>
                {partyValue && <strong className={partyValue.net >= 0 ? 'positive' : 'negative'}>{partyValue.net >= 0 ? '+' : ''}{formatValue(partyValue.net)} market net</strong>}
              </section>
            )
          })}
        </div>
        <div className="journal-foot">
          <span className={baseline?.retrospective ? 'retro-pill' : 'captured-pill'}>
            {baseline?.retrospective ? 'Backfilled with current values' : baseline ? 'Captured near ingestion' : 'Value snapshot unavailable'}
          </span>
          <div className="outcome-chips">
            {outcomes.map((outcome) => <span key={outcome.checkpointDays} className={`outcome-${outcome.status}`}><b>{outcome.checkpointDays}d</b> {outcome.status === 'complete' ? outcome.grade : outcome.status.replace('_', ' ')}</span>)}
          </div>
        </div>
      </article>
    )
  }

  return (
    <main className="page-shell journal-page">
      <section className="journal-hero">
        <div><span className="eyebrow accent-eyebrow">Private decision + completed trade journal · V8.0</span><h1>Offers and outcomes.<br />No selective memory.</h1><p>{leagueContext.label}: your saved offers, counters, rejections, and theses sit beside Sleeper-completed trades and immutable outcome snapshots.</p></div>
        <button type="button" className="journal-sync" onClick={onSync} disabled={syncing}><RefreshCw size={17} className={syncing ? 'spin' : ''} /> {syncing ? 'Syncing every season…' : 'Sync journal'}</button>
      </section>
      <section className="journal-stats">
        <article className="panel"><small>Completed trades</small><strong>{journal.trades.length}</strong><span>{journal.sync?.seasonsFound ?? seasons.length} linked seasons</span></article>
        <article className="panel"><small>API coverage</small><strong>{Math.round(coverage * 100)}%</strong><span>{journal.sync?.status ?? 'not synced'} · {journal.sync?.errors.length ?? 0} failed targets</span></article>
        <article className="panel"><small>Outcome checks</small><strong>{completedOutcomes}</strong><span>{pendingOutcomes} scheduled</span></article>
        <article className="panel"><small>Last completed</small><strong>{journal.sync?.finishedAt ? timeAgo(journal.sync.finishedAt) : 'Never'}</strong><span>manual refresh on demand</span></article>
      </section>
      {journal.sync?.status === 'partial' && <div className="journal-warning"><AlertTriangle size={17} /> Some Sleeper requests failed. The journal preserved prior data and exposes the incomplete coverage instead of treating it as zero trades.</div>}
      {decisionError && <div className="journal-warning"><AlertTriangle size={17} /> {decisionError}</div>}
      <section className="decision-ledger panel">
        <div className="panel-heading"><div><span className="eyebrow">V8.0 private negotiation labels</span><h2>Researching, offered, countered, and rejected packages</h2></div><span className="method-note">{decisions.length} saved decisions</span></div>
        {decisions.length ? <div className="decision-ledger-list">{decisions.map((decision) => <article key={decision.id}>
          <header><div><small>{new Date(decision.updatedAt).toLocaleString()}</small><strong>{decision.receive.map((asset) => asset.name).join(' + ')}</strong><span>for {decision.send.map((asset) => asset.name).join(' + ')}</span></div><select aria-label={`Status for ${decision.receive.map((asset) => asset.name).join(' + ')}`} value={decision.status} disabled={updatingDecision === decision.id} onChange={(event) => void setDecisionStatus(decision.id, event.target.value as TradeDecisionStatus)}><option value="researching">Researching</option><option value="offered">Offered</option><option value="countered">Countered</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="withdrawn">Withdrawn</option></select></header>
          <div className="decision-snapshot-facts"><span><small>Saved market net</small><b className={decision.snapshot.marketNetToMe >= 0 ? 'positive' : 'negative'}>{decision.snapshot.marketNetToMe >= 0 ? '+' : ''}{formatValue(decision.snapshot.marketNetToMe)}</b></span><span><small>{decision.snapshot.holdingPeriodDays ?? 30}-day forward P&amp;L</small><b>{formatForwardPnl(decision.snapshot.forwardExpectedPnl, decision.snapshot.expectedPnl30)}</b></span><span><small>Tracked downside</small><b>{formatForwardPnl(decision.snapshot.forwardTrackedLowerPnl, decision.snapshot.trackedAssetLowerPnl30)}</b></span><span><small>Forward model</small><b>{decision.snapshot.forwardStatus ?? '30d legacy'}</b></span></div>
          <p><strong>Thesis:</strong> {decision.thesis}</p><p><strong>Hold:</strong> {decision.holdPeriod} <strong>Exit:</strong> {decision.exitCondition}</p>
        </article>)}</div> : <div className="journal-empty"><BookOpen size={22} /><strong>No negotiation decisions saved yet.</strong><span>Build a package in Trade Lab and save the thesis before sending it.</span></div>}
      </section>
      <section className="journal-toolbar panel">
        <label><small>Season</small><select value={season} onChange={(event) => setSeason(event.target.value)}><option value="all">All linked seasons</option>{seasons.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <span>{visibleTrades.length} ledger entries · newest first</span>
      </section>
      <section className="journal-list">{visibleTrades.length ? visibleTrades.map(tradeCard) : <div className="panel journal-empty"><BookOpen size={22} /><strong>No completed trades stored yet.</strong><span>Run the journal sync to build the API ledger.</span></div>}</section>
      <div className="model-caveat panel"><Info size={17} /><span>Old trades are labeled retrospective because Sleeper does not provide historic calculator values. Only snapshots captured after RosterLab started tracking a deal can support honest 7/30/90/180-day outcome grading. Those prices use the {leagueContext.labels.market}, not an invented exact +{leagueContext.scoring.tePremiumPerReception} TEP history.</span></div>
    </main>
  )
}
