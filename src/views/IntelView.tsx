import { ArrowDownRight, ArrowUpRight, BellRing, Bookmark, Clock3, ExternalLink, LockKeyhole, Radar, RefreshCw, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchAlerts, fetchIntel, updateAlertReadState } from '../api'
import { buildIntelSignals, timeAgo } from '../intel'
import type { AlertInbox, EventModelHealthBundle, IntelFeed, IntelSignal, LeaguePreferences, Team, ValueBundle } from '../types'
import { AssetBadge, signedPercent } from '../components/domain-ui'

function DirectionMark({ direction }: { direction: IntelSignal['direction'] }) {
  if (direction === 'up') return <ArrowUpRight size={16} />
  if (direction === 'down') return <ArrowDownRight size={16} />
  return <Radar size={16} />
}
export function IntelView({
  teams,
  valueBundle,
  eventHealth,
  preferences,
  onUpdatePreferences,
}: {
  teams: Team[]
  valueBundle: ValueBundle
  eventHealth: EventModelHealthBundle | null
  preferences: LeaguePreferences
  onUpdatePreferences: (patch: Partial<LeaguePreferences>) => void
}) {
  const defaultTeam = teams.find((team) => team.rosterId === preferences.myRosterId) ?? teams[0]
  const [myRosterId, setMyRosterId] = useState(defaultTeam.rosterId)
  const [feed, setFeed] = useState<IntelFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'mine' | 'free' | 'watch'>('all')
  const [inbox, setInbox] = useState<AlertInbox | null>(null)
  const [inboxError, setInboxError] = useState<string | null>(null)

  useEffect(() => {
    if (preferences.myRosterId && teams.some((team) => team.rosterId === preferences.myRosterId)) {
      setMyRosterId(preferences.myRosterId)
    }
  }, [preferences.myRosterId, teams])

  const loadIntel = async () => {
    setLoading(true)
    setError(null)
    try {
      setFeed(await fetchIntel())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Intel feed unavailable')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadIntel()
  }, [])

  const loadInbox = async (sync = true) => {
    try {
      setInbox(await fetchAlerts(preferences.leagueId, sync))
      setInboxError(null)
    } catch (loadError) {
      setInboxError(loadError instanceof Error ? loadError.message : 'Alert inbox unavailable')
    }
  }

  useEffect(() => {
    void loadInbox(true)
    const interval = window.setInterval(() => void loadInbox(true), 5 * 60 * 1000)
    return () => window.clearInterval(interval)
  }, [preferences.leagueId, preferences.watchlist.join('|')])

  const signals = useMemo(
    () => feed ? buildIntelSignals(feed, valueBundle.players, teams, myRosterId) : [],
    [feed, myRosterId, teams, valueBundle.players],
  )
  const filteredSignals = signals.filter((signal) => {
    if (filter === 'mine') return signal.isMine
    if (filter === 'free') return !signal.ownerTeam
    if (filter === 'watch') return preferences.watchlist.includes(String(signal.player.sleeperId))
    return true
  }).sort((a, b) => {
    const latest = (signal: IntelSignal) => Math.max(0, ...signal.articles.map((article) => Date.parse(article.publishedAt)))
    return latest(b) - latest(a) || a.player.name.localeCompare(b.player.name)
  })
  const toggleWatch = (playerId: string) => {
    const watchlist = preferences.watchlist.includes(playerId)
      ? preferences.watchlist.filter((item) => item !== playerId)
      : [...preferences.watchlist, playerId]
    onUpdatePreferences({ watchlist })
  }
  const myTeam = teams.find((team) => team.rosterId === myRosterId) ?? teams[0]
  const rosterPulse = signals.filter((signal) => signal.isMine).slice(0, 5)
  const freshArticles = feed?.articles.filter(
    (article) => Date.now() - Date.parse(article.publishedAt) <= 24 * 60 * 60 * 1000,
  ).length ?? 0
  const healthySources = feed?.sources.filter((source) => source.ok).length ?? 0
  const intelGate = feed?.phaseGates?.['v2.0']

  return (
    <main className="page-shell intel-page">
      <section className="intel-hero">
        <div>
          <span className="eyebrow accent-eyebrow">Private signal desk</span>
          <h1>Read the reports.<br />Keep price separate.</h1>
          <p>Current NFL headlines and Sleeper add/drop counts map onto league rosters. They are unvalidated watch evidence and do not change player values or target ordering.</p>
        </div>
        <div className="private-status">
          <LockKeyhole size={18} />
          <span><strong>Owner-only</strong><small>This signal desk is not on a public deployment.</small></span>
        </div>
      </section>

      <section className="intel-toolbar panel">
        <label>
          <small>My team</small>
          <select value={myRosterId} onChange={(event) => {
            const rosterId = Number(event.target.value)
            setMyRosterId(rosterId)
            onUpdatePreferences({ myRosterId: rosterId })
          }}>
            {teams.map((team) => <option key={team.rosterId} value={team.rosterId}>{team.teamName}</option>)}
          </select>
        </label>
        <div className="intel-tabs" role="group" aria-label="Signal filter">
          {(['all', 'mine', 'free', 'watch'] as const).map((item) => (
            <button key={item} type="button" className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
              {item === 'all' ? 'All reports' : item === 'mine' ? 'My roster' : item === 'free' ? 'Free agents' : `Watchlist (${preferences.watchlist.length})`}
            </button>
          ))}
        </div>
        <button type="button" className="intel-refresh" onClick={() => void loadIntel()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> Refresh signals
        </button>
      </section>

      {error && <div className="intel-error">Signal refresh failed: {error}</div>}

      <section className="intel-stat-strip" aria-label="Intel status">
        <div><span><Clock3 size={17} /></span><small>Fresh headlines</small><strong>{freshArticles}</strong><em>last 24 hours</em></div>
        <div><span><Zap size={17} /></span><small>Matched players</small><strong>{signals.length}</strong><em>news-to-player links</em></div>
        <div><span><Radar size={17} /></span><small>Intel research gate</small><strong>{intelGate?.enabled ? 'Passed' : 'Shadow'}</strong><em>{healthySources}/{feed?.sources.length ?? 3} live sources</em></div>
      </section>

      <section className="intel-layout">
        <div className="intel-opportunities panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Report queue</span><h2>Players with current coverage</h2></div>
            <span className="method-note">Newest linked report first</span>
          </div>
          {loading && !feed ? (
            <div className="intel-loading"><RefreshCw className="spin" size={22} /> Reading the market…</div>
          ) : filteredSignals.length ? (
            <div className="signal-list">
              {filteredSignals.slice(0, 10).map((signal) => (
                <article className={`signal-card direction-${signal.direction}`} key={signal.player.sleeperId}>
                  <div className="signal-score"><strong>News</strong><small>watch</small></div>
                  <div className="signal-main">
                    <div className="signal-title-row">
                      <div><AssetBadge position={signal.player.position} /><h3>{signal.player.name}</h3><span>{signal.player.team ?? 'FA'}</span></div>
                      <span className="direction-pill flat"><Radar size={15} /> unpriced</span>
                    </div>
                    <p>Linked coverage only. Verify the report and compare later market observations before treating it as an actionable signal.</p>
                    <div className="signal-meta">
                      <span><b>{signal.add24}</b> adds</span>
                      <span><b>{signal.drop24}</b> drops</span>
                      <span>{signal.ownerTeam ? signal.ownerTeam.teamName : 'Free agent'}</span>
                    </div>
                    {!!signal.articles.length && (
                      <div className="signal-headlines">
                        {signal.articles.slice(0, 2).map((article) => (
                          <a href={article.url} target="_blank" rel="noreferrer" key={article.id}>
                            <span>{article.eventType ? `${article.eventType} · ` : ''}{article.source}{(article.corroborationCount ?? 1) > 1 ? ` +${(article.corroborationCount ?? 1) - 1}` : ''} · {timeAgo(article.publishedAt)}</span>
                            {article.title}<ExternalLink size={13} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="signal-action"><small>Model use</small><strong>Watch only</strong></div>
                  <button
                    type="button"
                    className={`signal-watch ${preferences.watchlist.includes(String(signal.player.sleeperId)) ? 'active' : ''}`}
                    onClick={() => toggleWatch(String(signal.player.sleeperId))}
                    aria-label={`${preferences.watchlist.includes(String(signal.player.sleeperId)) ? 'Remove' : 'Add'} ${signal.player.name} ${preferences.watchlist.includes(String(signal.player.sleeperId)) ? 'from' : 'to'} watchlist`}
                  >
                    <Bookmark size={15} fill={preferences.watchlist.includes(String(signal.player.sleeperId)) ? 'currentColor' : 'none'} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="intel-empty"><Radar size={22} /><strong>No matching signal yet.</strong><span>Quiet is useful too—don’t manufacture a move.</span></div>
          )}
        </div>

        <aside className="intel-sidebar">
          <section className="alert-inbox panel">
            <div className="panel-heading"><div><span className="eyebrow">Private alert inbox</span><h2>{inbox?.unreadCount ?? 0} unread</h2></div><BellRing size={18} /></div>
            <p className="quiet-copy">Watched-player headlines persist here per user and league. Refreshes every five minutes while this page is open.</p>
            {inboxError && <p className="alert-error">{inboxError}</p>}
            {inbox?.alerts.length ? inbox.alerts.slice(0, 6).map((alert) => {
              const player = valueBundle.players.find((item) => String(item.sleeperId) === alert.playerId)
              const source = alert.sources[0]
              return (
                <article className={`alert-row ${alert.readAt ? '' : 'unread'}`} key={alert.eventKey}>
                  <span className={`pulse-mark ${alert.direction}`}><DirectionMark direction={alert.direction} /></span>
                  <div><strong>{player?.name ?? 'Watched player'}</strong><p>{alert.title}</p><small>{alert.eventType} · {timeAgo(alert.publishedAt)}{alert.corroborationCount > 1 ? ` · ${alert.corroborationCount} sources` : ''}</small></div>
                  <div className="alert-actions">
                    {source?.url && <a href={source.url} target="_blank" rel="noreferrer" aria-label="Open report"><ExternalLink size={14} /></a>}
                    <button type="button" onClick={() => void updateAlertReadState(preferences.leagueId, [alert.eventKey], !alert.readAt).then(setInbox)}>{alert.readAt ? 'Unread' : 'Read'}</button>
                  </div>
                </article>
              )
            }) : <div className="intel-empty"><BellRing size={20} /><strong>No watchlist alerts yet.</strong><span>Add a player to the watchlist; only confidently matched headlines create alerts.</span></div>}
            <div className={`alert-health ${inbox?.status.stale ? 'stale' : ''}`}><i />{inbox?.status.lastSuccessAt ? `Checked ${timeAgo(inbox.status.lastSuccessAt)}` : 'Not checked yet'}{inbox?.status.errorMessage ? ` · ${inbox.status.errorMessage}` : ''}</div>
          </section>
          <section className="roster-pulse panel">
            <div className="panel-heading"><div><span className="eyebrow">Roster pulse</span><h2>{myTeam.teamName}</h2></div></div>
            {rosterPulse.length ? rosterPulse.map((signal) => (
              <div className="pulse-row" key={signal.player.sleeperId}>
                <span className={`pulse-mark ${signal.direction}`}><DirectionMark direction={signal.direction} /></span>
                <span><strong>{signal.player.name}</strong><small>{signal.articles[0]?.title ?? 'Linked current report'}</small></span>
                <b>Watch</b>
              </div>
            )) : <p className="quiet-copy">No urgent news matched your roster. That’s a green light to stay patient.</p>}
          </section>

          {eventHealth && (
            <section className="intel-method panel event-evidence">
              <span className="eyebrow">Historical event test · {eventHealth.testSeason}</span>
              <h3>{eventHealth.enabled ? 'Adjustment model passed.' : 'Evidence only—not an auto-bump.'}</h3>
              <p>{eventHealth.eventTestRows} held-out player-weeks produced a {signedPercent(eventHealth.maeImprovement)} MAE lift. The 5% promotion gate {eventHealth.enabled ? 'passed' : 'did not pass'}, so these deltas stay advisory.</p>
              <div className="event-signal-list">
                {eventHealth.signals.filter((signal) => signal.sampleSize >= 75 && (
                  signal.direction === 'watch'
                  || (signal.direction === 'up' && signal.observedPpgChange > 0)
                  || (signal.direction === 'down' && signal.observedPpgChange < 0)
                )).slice(0, 3).map((signal) => (
                  <div key={signal.id}>
                    <span><strong>{signal.label}</strong><small>{signal.sampleSize} examples · {signal.confidence} confidence</small></span>
                    <b className={signal.observedPpgChange >= 0 ? 'positive' : 'negative'}>{signal.observedPpgChange >= 0 ? '+' : ''}{signal.observedPpgChange.toFixed(1)} PPG</b>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="intel-method panel">
            <span className="eyebrow">How to use this</span>
            <h3>A lead, not a verdict.</h3>
            <p>The feed deduplicates and links reports to players. It does not know whether a headline is mispriced, what the future return will be, or whether another manager will accept an offer.</p>
            {feed?.qa && <p>{feed.qa.duplicatesRemoved} duplicate reports collapsed. The event classifier is {(feed.qa.classifierFixtureAccuracy * 100).toFixed(0)}% accurate on {feed.qa.classifierFixtureCount} labeled fixtures. Intel remains advisory.</p>}
            <div className="source-health">
              {(feed?.sources ?? []).map((source) => (
                <span key={source.name}><i className={source.ok ? 'online' : ''} />{source.name}</span>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}
