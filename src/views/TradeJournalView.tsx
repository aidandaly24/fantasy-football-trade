import { AlertTriangle, BookOpen, Info, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { timeAgo } from '../intel'
import { tradePartyNames } from '../journal'
import type { LeagueContext } from '../league-context'
import type { JournalBundle, JournalTrade } from '../types'
import { AssetBadge, formatValue } from '../components/domain-ui'

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
        <div><span className="eyebrow accent-eyebrow">Automated trade journal · V4.6</span><h1>Every completed deal.<br />No selective memory.</h1><p>{leagueContext.label}: Sleeper facts, season-correct manager identity, immutable value snapshots, and automatic 7/30/90/180-day checkpoints.</p></div>
        <button type="button" className="journal-sync" onClick={onSync} disabled={syncing}><RefreshCw size={17} className={syncing ? 'spin' : ''} /> {syncing ? 'Syncing every season…' : 'Sync journal'}</button>
      </section>
      <section className="journal-stats">
        <article className="panel"><small>Completed trades</small><strong>{journal.trades.length}</strong><span>{journal.sync?.seasonsFound ?? seasons.length} linked seasons</span></article>
        <article className="panel"><small>API coverage</small><strong>{Math.round(coverage * 100)}%</strong><span>{journal.sync?.status ?? 'not synced'} · {journal.sync?.errors.length ?? 0} failed targets</span></article>
        <article className="panel"><small>Outcome checks</small><strong>{completedOutcomes}</strong><span>{pendingOutcomes} scheduled</span></article>
        <article className="panel"><small>Last completed</small><strong>{journal.sync?.finishedAt ? timeAgo(journal.sync.finishedAt) : 'Never'}</strong><span>automatic refresh on league load</span></article>
      </section>
      {journal.sync?.status === 'partial' && <div className="journal-warning"><AlertTriangle size={17} /> Some Sleeper requests failed. The journal preserved prior data and exposes the incomplete coverage instead of treating it as zero trades.</div>}
      <section className="journal-toolbar panel">
        <label><small>Season</small><select value={season} onChange={(event) => setSeason(event.target.value)}><option value="all">All linked seasons</option>{seasons.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <span>{visibleTrades.length} ledger entries · newest first</span>
      </section>
      <section className="journal-list">{visibleTrades.length ? visibleTrades.map(tradeCard) : <div className="panel journal-empty"><BookOpen size={22} /><strong>No completed trades stored yet.</strong><span>Run the journal sync to build the API ledger.</span></div>}</section>
      <div className="model-caveat panel"><Info size={17} /><span>Old trades are labeled retrospective because Sleeper does not provide historic calculator values. Only snapshots captured after RosterLab started tracking a deal can support honest 7/30/90/180-day outcome grading. Those prices use the {leagueContext.labels.market}, not an invented exact +{leagueContext.scoring.tePremiumPerReception} TEP history.</span></div>
    </main>
  )
}
