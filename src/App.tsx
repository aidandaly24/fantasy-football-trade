import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BellRing,
  BookOpen,
  Bookmark,
  Check,
  ChevronRight,
  CircleGauge,
  Clock3,
  ExternalLink,
  Handshake,
  Info,
  LockKeyhole,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Zap,
  X,
} from 'lucide-react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { fetchAlerts, fetchEventModelHealth, fetchIntel, fetchJournal, fetchLeagueBundle, fetchModelHealth, fetchProjections, fetchSleeperPlayers, fetchUserState, fetchValues, saveLeaguePreferences, syncJournal, updateAlertReadState } from './api'
import { buildIntelSignals, timeAgo } from './intel'
import { journalTransactionsForCurrentManagers, tradePartyNames } from './journal'
import { buildManagerProfiles } from './negotiation'
import type { ManagerProfile } from './negotiation'
import { assetRoleLabel, buildTeams, evaluateTrade, leagueFormat, rosterProfile } from './rankings'
import { buildTradePlan } from './strategy'
import type { Asset, AlertInbox, EventModelHealthBundle, IntelFeed, IntelSignal, JournalBundle, JournalTrade, LeagueBundle, LeaguePreferences, ModelHealthBundle, RankingMode, Team, UserIdentity, UserState, ValueBundle } from './types'

const DEFAULT_LEAGUE_ID = '1336087922847289344'

type AppData = {
  leagueBundle: LeagueBundle
  valueBundle: ValueBundle
  teams: Team[]
  modelHealth: ModelHealthBundle | null
  eventModelHealth: EventModelHealthBundle | null
  managerProfiles: ManagerProfile[]
  journal: JournalBundle
  preferences: LeaguePreferences
  user: UserIdentity | null
}

type View = 'rankings' | 'trade' | 'journal' | 'intel' | 'strategy' | 'model'

const modeCopy: Record<RankingMode, { label: string; description: string }> = {
  overall: {
    label: 'Roster power',
    description: 'Replacement-adjusted starters plus market depth, age-resilient core value, and actual pick volume.',
  },
  contender: {
    label: 'Lineup',
    description: 'The best legal starting lineup, penalized for empty slots and backed by usable depth.',
  },
  future: {
    label: '2-year base',
    description: 'Age-resilient player value, tradeable depth, and the full volume of owned rookie picks.',
  },
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function Avatar({ team, size = 'md' }: { team: Team; size?: 'sm' | 'md' | 'lg' }) {
  if (team.avatar) {
    return <img className={`avatar avatar-${size}`} src={team.avatar} alt="" />
  }
  return <span className={`avatar avatar-${size} avatar-fallback`}>{initials(team.teamName)}</span>
}

function AssetBadge({ position }: { position: Asset['position'] }) {
  return <span className={`position-badge pos-${position.toLowerCase()}`}>{position}</span>
}

function scoreLabel(value: number) {
  if (value >= 88) return 'Elite'
  if (value >= 75) return 'Strong'
  if (value >= 60) return 'Solid'
  if (value >= 45) return 'Thin'
  return 'Rework'
}

function formatValue(value: number) {
  const rounded = Math.round(value)
  return new Intl.NumberFormat('en-US').format(Object.is(rounded, -0) ? 0 : rounded)
}

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-row">
      <div className="metric-label">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="metric-track" aria-hidden="true">
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function RankingBoard({
  teams,
  mode,
  selectedId,
  onSelect,
}: {
  teams: Team[]
  mode: RankingMode
  selectedId: number
  onSelect: (id: number) => void
}) {
  return (
    <div className="ranking-board panel">
      <div className="panel-heading ranking-heading">
        <div>
          <span className="eyebrow">League table</span>
          <h2>{modeCopy[mode].label} power</h2>
        </div>
        <span className="method-note">0–100 league-relative</span>
      </div>
      <div className="ranking-list">
        {teams.map((team, index) => {
          const score = team.metrics[mode]
          return (
            <button
              type="button"
              className={`ranking-row ${team.rosterId === selectedId ? 'selected' : ''}`}
              key={team.rosterId}
              onClick={() => onSelect(team.rosterId)}
            >
              <span className={`rank-number rank-${index + 1}`}>{index + 1}</span>
              <Avatar team={team} size="sm" />
              <span className="rank-team-copy">
                <strong>{team.teamName}</strong>
                <small>@{team.ownerName}</small>
              </span>
              <span className="rank-score-block">
                <span className="rank-score-line">
                  <b>{score}</b>
                  <small>{scoreLabel(score)}</small>
                </span>
                <span className="rank-track">
                  <span style={{ width: `${score}%` }} />
                </span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TeamScout({ team, teams }: { team: Team; teams: Team[] }) {
  const profile = rosterProfile(team, teams)
  const topAssets = [...team.players, ...team.picks].sort((a, b) => b.value - a.value).slice(0, 6)
  const rank = [...teams]
    .sort((a, b) => b.metrics.overall - a.metrics.overall)
    .findIndex((item) => item.rosterId === team.rosterId) + 1

  return (
    <aside className="team-scout panel">
      <div className="scout-hero">
        <div className="scout-topline">
          <span className="window-pill"><Sparkles size={14} /> {profile.label}</span>
          <span className="overall-rank">#{rank} overall</span>
        </div>
        <div className="scout-identity">
          <Avatar team={team} size="lg" />
          <div>
            <h2>{team.teamName}</h2>
            <p>Managed by {team.ownerName}</p>
          </div>
        </div>
        <p className="window-copy">{profile.description}</p>
      </div>

      <div className="scout-section metrics-grid">
        <MetricBar label="Starting lineup" value={team.metrics.lineup} />
        <MetricBar label="Dynasty core" value={team.metrics.core} />
        <MetricBar label="Bench depth" value={team.metrics.depth} />
        <MetricBar label="Draft capital" value={team.metrics.picks} />
      </div>
      <div className="scout-model-note">
        Scores are league percentiles. Lineup uses positional replacement levels; pick score rewards total capital, not the average pick.
      </div>

      <div className="scout-section">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">Asset board</span>
            <h3>Most valuable pieces</h3>
          </div>
          <span className="asset-count">{team.players.length + team.picks.length} assets</span>
        </div>
        <div className="asset-stack">
          {topAssets.map((asset, index) => (
            <div className="scout-asset" key={asset.id}>
              <span className="asset-index">{index + 1}</span>
              <AssetBadge position={asset.position} />
              <span className="asset-main">
                <strong>{asset.name}</strong>
                <small>
                  {asset.kind === 'player'
                    ? [asset.team, asset.age ? `Age ${asset.age.toFixed(1)}` : null].filter(Boolean).join(' · ')
                    : asset.slot
                      ? 'Exact draft slot'
                      : `Likely ${asset.projectedTier ?? 'mid'} · ${formatValue(asset.valueLow ?? asset.value)}–${formatValue(asset.valueHigh ?? asset.value)}`}
                </small>
              </span>
              <b className="asset-value">{formatValue(asset.value)}</b>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

function RankingsView({
  teams,
  mode,
  setMode,
  selectedId,
  setSelectedId,
}: {
  teams: Team[]
  mode: RankingMode
  setMode: (mode: RankingMode) => void
  selectedId: number
  setSelectedId: (id: number) => void
}) {
  const sorted = useMemo(
    () => [...teams].sort((a, b) => b.metrics[mode] - a.metrics[mode]),
    [mode, teams],
  )
  const selectedTeam = teams.find((team) => team.rosterId === selectedId) ?? sorted[0]
  const lineupLeader = [...teams].sort((a, b) => b.metrics.lineup - a.metrics.lineup)[0]
  const coreLeader = [...teams].sort((a, b) => b.metrics.core - a.metrics.core)[0]
  const pickLeader = [...teams].sort((a, b) => b.metrics.picks - a.metrics.picks)[0]

  return (
    <main className="page-shell">
      <section className="page-intro">
        <div>
          <span className="eyebrow accent-eyebrow">League intelligence</span>
          <h1>Know who’s built to win.<br />And who’s built to deal.</h1>
          <p>{modeCopy[mode].description}</p>
        </div>
        <div className="mode-switch" role="group" aria-label="Ranking model">
          {(Object.keys(modeCopy) as RankingMode[]).map((item) => (
            <button
              type="button"
              key={item}
              className={item === mode ? 'active' : ''}
              onClick={() => setMode(item)}
            >
              {modeCopy[item].label}
            </button>
          ))}
        </div>
      </section>

      <section className="leader-strip" aria-label="League leaders">
        <div className="leader-card">
          <span className="leader-icon"><Trophy size={19} /></span>
          <span><small>Best lineup</small><strong>{lineupLeader.teamName}</strong></span>
          <b>{lineupLeader.metrics.lineup}</b>
        </div>
        <div className="leader-card">
          <span className="leader-icon"><TrendingUp size={19} /></span>
          <span><small>Best dynasty core</small><strong>{coreLeader.teamName}</strong></span>
          <b>{coreLeader.metrics.core}</b>
        </div>
        <div className="leader-card">
          <span className="leader-icon"><Target size={19} /></span>
          <span><small>Most draft capital</small><strong>{pickLeader.teamName}</strong></span>
          <b>{pickLeader.metrics.picks}</b>
        </div>
      </section>

      <section className="rankings-layout">
        <RankingBoard teams={sorted} mode={mode} selectedId={selectedTeam.rosterId} onSelect={setSelectedId} />
        <TeamScout team={selectedTeam} teams={teams} />
      </section>
    </main>
  )
}

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
              : `Auto: likely ${asset.projectedTier ?? 'mid'} · ${formatValue(asset.valueLow ?? asset.value)}–${formatValue(asset.valueHigh ?? asset.value)}`}
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
  sideA,
  sideB,
  rosterPositions,
}: {
  teamA: Team
  teamB: Team
  sideA: Asset[]
  sideB: Asset[]
  rosterPositions: string[]
}) {
  const result = evaluateTrade(sideA, sideB, { teamA, teamB, rosterPositions })
  const lead = result.winner === 'A' ? 'a' : result.winner === 'B' ? 'b' : 'even'
  const ready = sideA.length > 0 && sideB.length > 0
  const compactVerdict = result.verdict
    .replace(teamA.teamName, 'Side A')
    .replace(teamB.teamName, 'Side B')
  return (
    <section className="trade-verdict panel">
      <div className={`verdict-orb verdict-${lead}`}>
        <CircleGauge size={23} />
        <span>{compactVerdict}</span>
      </div>
      <div className="trade-rating-pair">
        <span><small>{teamA.teamName}</small><strong>{ready ? result.gradeA : '—'}</strong><em>{ready ? `${result.ratingA}/100` : 'rating'}</em></span>
        <b>vs</b>
        <span><small>{teamB.teamName}</small><strong>{ready ? result.gradeB : '—'}</strong><em>{ready ? `${result.ratingB}/100` : 'rating'}</em></span>
      </div>
      <div className="value-versus">
        <span><small>Side A sends</small><strong>{formatValue(result.valueA)}</strong></span>
        <b>vs</b>
        <span><small>Side B sends</small><strong>{formatValue(result.valueB)}</strong></span>
      </div>
      <div className="fairness-scale">
        <span className="scale-labels"><small>A wins</small><small>Fair zone</small><small>B wins</small></span>
        <div className="scale-track">
          <span className="fair-zone" />
          <i style={{ left: `${Math.max(2, Math.min(98, 100 - result.ratingA))}%` }} />
        </div>
      </div>
      <p className="verdict-copy">
        {!ready
          ? 'Select at least one asset on each side to get a market verdict.'
          : result.fair
            ? `Only ${result.difference.toFixed(1)}% separates the packages. The rating still accounts for each roster's starter impact.`
            : `${result.difference.toFixed(1)}% separates the packages before the roster-fit adjustment.`}
      </p>
      {ready && (
        <div className="trade-lenses">
          <span><small>A market edge</small><b className={result.marketNetA > 0 ? 'positive' : result.marketNetA < 0 ? 'negative' : ''}>{result.marketNetA > 0 ? '+' : ''}{formatValue(result.marketNetA)}</b></span>
          <span><small>ML coverage</small><b>{result.projectionCoverage}%</b></span>
          <span><small>A incoming stability</small><b>{result.incomingStabilityA}%</b></span>
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
        <span>ML production is expected PPR per team week, so missed games count. Market price and current role stay separate; uncovered players use a transparent fallback.</span>
      </div>
    </section>
  )
}

function RosterImpact({
  teamA,
  teamB,
  sideA,
  sideB,
  rosterPositions,
}: {
  teamA: Team
  teamB: Team
  sideA: Asset[]
  sideB: Asset[]
  rosterPositions: string[]
}) {
  const value = evaluateTrade(sideA, sideB, { teamA, teamB, rosterPositions })
  const netA = value.marketNetA
  const netB = -value.marketNetA
  const topA = [...sideA].sort((a, b) => b.value - a.value)[0]
  const topB = [...sideB].sort((a, b) => b.value - a.value)[0]
  const spotsA = sideA.length - sideB.length

  const rows = [
    { label: 'Adjusted market value', a: netA, b: netB, suffix: '', decimals: false },
    { label: 'Projected lineup PPG', a: value.lineupImpactA ?? 0, b: value.lineupImpactB ?? 0, suffix: '', decimals: true },
    { label: 'Roster spots opened', a: spotsA, b: -spotsA, suffix: '', decimals: false },
  ]

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
            <b className={row.a > 0 ? 'positive' : row.a < 0 ? 'negative' : ''}>{row.a > 0 ? '+' : ''}{row.decimals ? row.a.toFixed(1) : formatValue(row.a)}{row.suffix}</b>
            <span>{row.label}</span>
            <b className={row.b > 0 ? 'positive' : row.b < 0 ? 'negative' : ''}>{row.b > 0 ? '+' : ''}{row.decimals ? row.b.toFixed(1) : formatValue(row.b)}{row.suffix}</b>
          </div>
        ))}
        {(value.rangeA.worst !== value.rangeA.best || value.rangeB.worst !== value.rangeB.best) && (
          <div className="impact-row impact-range-row">
            <b>{formatValue(value.rangeA.worst)} to {formatValue(value.rangeA.best)}</b>
            <span>Pick scenario range</span>
            <b>{formatValue(value.rangeB.worst)} to {formatValue(value.rangeB.best)}</b>
          </div>
        )}
        <div className="impact-row">
          <b>{topB?.name ?? '—'}</b>
          <span>Best asset received</span>
          <b>{topA?.name ?? '—'}</b>
        </div>
      </div>
    </section>
  )
}

function TradeView({ teams, rosterPositions }: { teams: Team[]; rosterPositions: string[] }) {
  const [teamAId, setTeamAId] = useState(teams[0].rosterId)
  const [teamBId, setTeamBId] = useState(teams[1]?.rosterId ?? teams[0].rosterId)
  const [selectedA, setSelectedA] = useState<string[]>([])
  const [selectedB, setSelectedB] = useState<string[]>([])
  const [searchA, setSearchA] = useState('')
  const [searchB, setSearchB] = useState('')
  const teamA = teams.find((team) => team.rosterId === teamAId) ?? teams[0]
  const teamB = teams.find((team) => team.rosterId === teamBId) ?? teams[1] ?? teams[0]
  const assetsA = [...teamA.players, ...teamA.picks].filter((asset) => selectedA.includes(asset.id))
  const assetsB = [...teamB.players, ...teamB.picks].filter((asset) => selectedB.includes(asset.id))

  const toggle = (ids: string[], setIds: (value: string[]) => void, id: string) => {
    setIds(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])
  }

  return (
    <main className="page-shell trade-page">
      <section className="page-intro trade-intro">
        <div>
          <span className="eyebrow accent-eyebrow">Trade laboratory</span>
          <h1>Price the deal.<br />Then read the room.</h1>
          <p>Consensus market price, tested production forecasts, current NFL role, and downside risk—kept separate, then combined transparently.</p>
        </div>
        <div className="live-value-chip"><span /> Daily market values</div>
      </section>

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
        <TradeVerdict teamA={teamA} teamB={teamB} sideA={assetsA} sideB={assetsB} rosterPositions={rosterPositions} />
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

      <RosterImpact teamA={teamA} teamB={teamB} sideA={assetsA} sideB={assetsB} rosterPositions={rosterPositions} />
    </main>
  )
}

function TradeJournalView({
  journal,
  syncing,
  onSync,
}: {
  journal: JournalBundle
  syncing: boolean
  onSync: () => void
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
        <div><span className="eyebrow accent-eyebrow">Automated trade journal · V3.3</span><h1>Every completed deal.<br />No selective memory.</h1><p>Sleeper facts, season-correct manager identity, immutable value snapshots, and automatic 30/90/180-day checkpoints.</p></div>
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
      <div className="model-caveat panel"><Info size={17} /><span>Old trades are labeled retrospective because Sleeper does not provide historic calculator values. Only snapshots captured after RosterLab started tracking a deal can support honest 30/90/180-day outcome grading.</span></div>
    </main>
  )
}

function DirectionMark({ direction }: { direction: IntelSignal['direction'] }) {
  if (direction === 'up') return <ArrowUpRight size={16} />
  if (direction === 'down') return <ArrowDownRight size={16} />
  return <Radar size={16} />
}

function IntelView({
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
  const actionableSignals = signals.filter((signal) => signal.edgeScore >= 50).length
  const intelGate = feed?.phaseGates?.['v2.0']

  return (
    <main className="page-shell intel-page">
      <section className="intel-hero">
        <div>
          <span className="eyebrow accent-eyebrow">Private signal desk</span>
          <h1>Information has a half-life.<br />Move before the market does.</h1>
          <p>Credible NFL headlines meet live Sleeper add/drop velocity, then map directly onto this league’s rosters.</p>
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
              {item === 'all' ? 'All targets' : item === 'mine' ? 'My roster' : item === 'free' ? 'Free agents' : `Watchlist (${preferences.watchlist.length})`}
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
        <div><span><Zap size={17} /></span><small>Unabsorbed edges</small><strong>{actionableSignals}</strong><em>edge score 50+</em></div>
        <div><span><Radar size={17} /></span><small>Intel QA gate</small><strong>{intelGate?.enabled ? 'Pass' : 'Watch'}</strong><em>{feed?.qa ? `${(feed.qa.classifierFixtureAccuracy * 100).toFixed(0)}% labels · ${(feed.qa.residualDuplicateRate * 100).toFixed(1)}% dupes` : `${healthySources}/${feed?.sources.length ?? 3} sources`}</em></div>
      </section>

      <section className="intel-layout">
        <div className="intel-opportunities panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Opportunity queue</span><h2>Players worth checking now</h2></div>
            <span className="method-note">Edge = evidence minus market reaction</span>
          </div>
          {loading && !feed ? (
            <div className="intel-loading"><RefreshCw className="spin" size={22} /> Reading the market…</div>
          ) : filteredSignals.length ? (
            <div className="signal-list">
              {filteredSignals.slice(0, 10).map((signal) => (
                <article className={`signal-card direction-${signal.direction}`} key={signal.player.sleeperId}>
                  <div className="signal-score"><strong>{signal.edgeScore}</strong><small>edge</small></div>
                  <div className="signal-main">
                    <div className="signal-title-row">
                      <div><AssetBadge position={signal.player.position} /><h3>{signal.player.name}</h3><span>{signal.player.team ?? 'FA'}</span></div>
                      <span className={`direction-pill ${signal.direction}`}><DirectionMark direction={signal.direction} /> {signal.direction}</span>
                    </div>
                    <p>{signal.rationale}</p>
                    <div className="signal-meta">
                      <span><b>{signal.impactScore}</b> impact</span>
                      <span><b>{signal.marketReactionScore}</b> reaction</span>
                      <span><b>{signal.add24}</b> adds</span>
                      <span><b>{signal.drop24}</b> drops</span>
                      <span><b>{signal.confidence}%</b> confidence</span>
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
                  <div className="signal-action"><small>Next move</small><strong>{signal.action}</strong></div>
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
                <span><strong>{signal.player.name}</strong><small>{signal.action}</small></span>
                <b>{signal.edgeScore}</b>
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
            <p>Impact measures the event. Confidence measures the reporting. Market reaction measures how much Sleeper has already moved. Edge is what may remain.</p>
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

function StrategyView({
  teams,
  profiles,
  myRosterId,
  rosterPositions,
  preferredRosterId,
  onUpdatePreferences,
}: {
  teams: Team[]
  profiles: ManagerProfile[]
  myRosterId: number
  rosterPositions: string[]
  preferredRosterId?: number
  onUpdatePreferences: (patch: Partial<LeaguePreferences>) => void
}) {
  const ordered = useMemo(
    () => [...profiles].filter((item) => item.rosterId !== myRosterId).sort((a, b) => b.tradeCount - a.tradeCount || a.teamName.localeCompare(b.teamName)),
    [profiles, myRosterId],
  )
  const [selectedRosterId, setSelectedRosterId] = useState(preferredRosterId ?? ordered[0]?.rosterId ?? teams[0]?.rosterId ?? 1)
  useEffect(() => {
    if (preferredRosterId && profiles.some((item) => item.rosterId === preferredRosterId)) {
      setSelectedRosterId(preferredRosterId)
    }
  }, [preferredRosterId, profiles])
  const profile = ordered.find((item) => item.rosterId === selectedRosterId) ?? ordered[0]
  const team = teams.find((item) => item.rosterId === profile?.rosterId) ?? teams[0]
  const plan = useMemo(() => profile ? buildTradePlan(teams, {
    myRosterId,
    counterpartRosterId: profile.rosterId,
    rosterPositions,
    manager: {
      pickAffinity: profile.pickShare,
      playerAffinity: 1 - profile.pickShare,
      consolidationIndex: Math.max(0, Math.min(1, 0.5 + (profile.averageAssetsSent - profile.averageAssetsReceived) / 3)),
      depthIndex: Math.max(0, Math.min(1, 0.5 + (profile.averageAssetsReceived - profile.averageAssetsSent) / 3)),
      positionAffinity: Object.fromEntries(profile.favoritePositions.map((position) => [position, 0.8])),
      sampleWeight: Math.min(1, profile.tradeCount / 12),
    },
  }) : null, [profile, myRosterId, rosterPositions, teams])

  if (!profile || !team) return null

  return (
    <main className="page-shell strategy-page">
      <section className="strategy-hero">
        <div>
          <span className="eyebrow accent-eyebrow">Negotiation room</span>
          <h1>Trade the manager.<br />Not just the calculator.</h1>
          <p>Completed Sleeper trades across linked league seasons reveal preferences. Small samples are labeled instead of oversold.</p>
        </div>
        <div className="private-status"><LockKeyhole size={18} /><span><strong>Private league evidence</strong><small>No profile is published outside this site.</small></span></div>
      </section>

      <section className="strategy-layout">
        <aside className="manager-list panel">
          <div className="panel-heading"><div><span className="eyebrow">League market</span><h2>Managers</h2></div></div>
          {ordered.map((item) => {
            const managerTeam = teams.find((candidate) => candidate.rosterId === item.rosterId) ?? team
            return (
              <button type="button" key={item.rosterId} className={item.rosterId === profile.rosterId ? 'active' : ''} onClick={() => {
                setSelectedRosterId(item.rosterId)
                onUpdatePreferences({ settings: { strategyRosterId: item.rosterId } })
              }}>
                <Avatar team={managerTeam} size="sm" />
                <span><strong>{item.teamName}</strong><small>{item.archetype} · {item.tradeCount} trades</small></span>
                <ChevronRight size={16} />
              </button>
            )
          })}
        </aside>

        <div className="manager-profile panel">
          <div className="manager-profile-hero">
            <Avatar team={team} size="lg" />
            <div><span className={`confidence-pill confidence-${profile.confidence}`}>{profile.confidence} confidence</span><h2>{profile.teamName}</h2><p>{profile.ownerName} · {profile.archetype}</p></div>
          </div>
          <p className="manager-summary">{profile.summary}</p>
          <div className="manager-evidence-grid">
            <div><small>Assets acquired</small><strong>{profile.receivedPlayers + profile.receivedPicks}</strong><span>{profile.receivedPlayers} players · {profile.receivedPicks} picks</span></div>
            <div><small>Assets sent</small><strong>{profile.sentPlayers + profile.sentPicks}</strong><span>{profile.sentPlayers} players · {profile.sentPicks} picks</span></div>
            <div><small>Pick appetite</small><strong>{Math.round(profile.pickShare * 100)}%</strong><span>share of acquired assets</span></div>
            <div><small>Current-value history</small><strong className={profile.currentValueDelta >= 0 ? 'positive' : 'negative'}>{profile.currentValueDelta >= 0 ? '+' : ''}{formatValue(profile.currentValueDelta)}</strong><span>hindsight, not causal skill</span></div>
          </div>
          <div className="negotiation-steps">
            <article><span>01</span><div><small>Opening offer</small><strong>{profile.opening}</strong></div></article>
            <article><span>02</span><div><small>Target structure</small><strong>{profile.target}</strong></div></article>
            <article><span>03</span><div><small>Walk-away line</small><strong>{profile.walkAway}</strong></div></article>
          </div>
          <div className="model-caveat"><Info size={17} /><span>{profile.evidenceNote}</span></div>
        </div>
      </section>
      {plan && (
        <section className="target-workbench">
          <div className="panel-heading"><div><span className="eyebrow">V4 target finder</span><h2>Best fits on {team.teamName}</h2></div><span className="method-note">Need + timeline + lineup + availability</span></div>
          <div className="target-grid">
            {plan.targets.slice(0, 3).map((target, index) => (
              <article className={`target-card panel ${index === 0 ? 'primary' : ''}`} key={target.asset.id}>
                <span className="target-rank">#{index + 1}</span><AssetBadge position={target.asset.position} />
                <h3>{target.asset.name}</h3><strong>{target.score}<small>/100 fit</small></strong>
                <div>{target.reasons.map((reason) => <span key={reason.label}>{reason.label} {reason.score}</span>)}</div>
                <p>{formatValue(target.asset.value)} market · {target.uncertaintyPenalty}% uncertainty</p>
              </article>
            ))}
          </div>
          <div className="package-board panel">
            <div className="panel-heading"><div><span className="eyebrow">V4.1 negotiation builder</span><h2>Staged packages</h2></div><span className="method-note">Walk-away is a ceiling, not a recommendation</span></div>
            {plan.packages.length ? plan.packages.map((tradePackage) => (
              <article className={`package-row stage-${tradePackage.stage}`} key={`${tradePackage.stage}-${tradePackage.send.map((asset) => asset.id).join('-')}`}>
                <span className="stage-label">{tradePackage.stage}</span>
                <div><small>You send</small><strong>{tradePackage.send.map((asset) => asset.name).join(' + ')}</strong></div>
                <ArrowLeftRight size={17} />
                <div><small>You receive</small><strong>{tradePackage.receive.map((asset) => asset.name).join(' + ')}</strong></div>
                <div className="package-scores"><span>Fit <b>{tradePackage.myScore}</b></span><span>Acceptance <b>{tradePackage.acceptanceScore}</b></span><span>Lineup <b>{tradePackage.lineupDeltaMe >= 0 ? '+' : ''}{tradePackage.lineupDeltaMe.toFixed(1)}</b></span></div>
              </article>
            )) : <div className="intel-empty"><Target size={22} /><strong>No safe package cleared the limits.</strong><span>That is a useful answer—do not force a bad trade.</span></div>}
            <div className="model-caveat"><Info size={17} /><span>{plan.evidenceNote}</span></div>
          </div>
        </section>
      )}
    </main>
  )
}

const baselineLabels: Record<string, string> = {
  repeatPrior: 'Repeat prior season',
  positionMean: 'Position average',
  shrinkToPosition: '75% prior + 25% position',
}

const sliceLabels: Record<string, string> = {
  all: 'All players',
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Wide receivers',
  TE: 'Tight ends',
  priorPpgUnder3: 'Under 3 prior PPG',
  priorPpg3to6: '3–6 prior PPG',
  priorPpg6to10: '6–10 prior PPG',
  priorPpgAtLeast10: '10+ prior PPG',
  gamesObserved1to8: '1–8 games observed',
  gamesObserved9to13: '9–13 games observed',
  gamesObserved14plus: '14+ games observed',
}

function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

function ModelView({ health }: { health: ModelHealthBundle | null }) {
  if (!health) {
    return (
      <main className="page-shell model-page">
        <section className="model-hero panel">
          <span className="eyebrow accent-eyebrow">Model audit</span>
          <h1>No trusted model report is available.</h1>
          <p>The calculator is using its transparent market-and-role fallback.</p>
        </section>
      </main>
    )
  }

  const importantSlices = health.slices.filter((slice) => slice.id !== 'all')
  const intervalPositions = Object.entries(health.interval.byPosition)
  const visibleGates = [
    ...health.gates,
    ...(health.phaseGates?.['v1.2']?.checks ?? []),
    ...(health.phaseGates?.['v1.3']?.checks ?? []),
    ...(health.phaseGates?.['v2.1']?.checks ?? []),
  ]

  return (
    <main className="page-shell model-page">
      <section className="model-hero panel">
        <div>
          <span className="eyebrow accent-eyebrow">Model audit · held-out {health.testSeason}</span>
          <h1>Trust is earned<br />one gate at a time.</h1>
          <p>The production forecast is allowed into lineup impact only when every visible test passes. Market prices and final grades remain separate.</p>
        </div>
        <div className={`model-status ${health.enabled ? 'enabled' : 'disabled'}`}>
          {health.enabled ? <Check size={20} /> : <AlertTriangle size={20} />}
          <span><strong>{health.enabled ? 'Production enabled' : 'Fallback only'}</strong><small>{health.model}</small></span>
        </div>
      </section>

      <section className="model-metric-grid" aria-label="Held-out model results">
        <article className="model-metric panel"><span>MAE improvement</span><strong>{signedPercent(health.metrics.maeImprovement)}</strong><small>against {baselineLabels[health.metrics.baselineName] ?? health.metrics.baselineName}</small></article>
        <article className="model-metric panel"><span>Model MAE</span><strong>{health.metrics.model.mae.toFixed(2)}</strong><small>baseline {health.metrics.baseline.mae.toFixed(2)}</small></article>
        <article className="model-metric panel"><span>Rank correlation</span><strong>{health.metrics.model.rank_correlation.toFixed(3)}</strong><small>{health.metrics.rankCorrelationDelta >= 0 ? '+' : ''}{health.metrics.rankCorrelationDelta.toFixed(3)} vs baseline</small></article>
        <article className="model-metric panel"><span>20–80 coverage</span><strong>{(health.interval.test.coverage * 100).toFixed(1)}%</strong><small>target {(health.interval.targetCoverage * 100).toFixed(0)}%</small></article>
        <article className="model-metric panel"><span>Current projections</span><strong>{health.currentPlayers}</strong><small>{health.freshness?.stale ? 'snapshot stale · fallback guarded' : `through ${health.freshness?.sourceSeason ?? 'current season'}`}</small></article>
      </section>

      <section className="model-layout">
        <div className="panel model-gates">
          <div className="panel-heading"><div><span className="eyebrow">Promotion gates</span><h2>All must pass</h2></div><span className="method-note">No manual override</span></div>
          <div className="gate-list">
            {visibleGates.map((gate) => (
              <div className={`gate-row ${gate.passed ? 'passed' : 'failed'}`} key={gate.id}>
                <span>{gate.passed ? <Check size={16} /> : <AlertTriangle size={16} />}</span>
                <div><strong>{gate.label}</strong><small>{gate.requirement}</small></div>
                <b>{['mae', 'positions', 'interval', 'contextMae', 'contextRegression', 'rosMae', 'rosPositions', 'eventMae', 'eventOverall', 'eventPositions'].includes(gate.id) ? `${(gate.actual * 100).toFixed(1)}%` : ['contextPositions', 'projectionCoverage', 'eventRows'].includes(gate.id) ? gate.actual.toFixed(0) : ['snapshotFreshness', 'deterministicRefresh'].includes(gate.id) ? (gate.passed ? 'pass' : 'fail') : gate.actual.toFixed(3)}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="panel interval-card">
          <div className="panel-heading"><div><span className="eyebrow">Uncertainty calibration</span><h2>Coverage by position</h2></div></div>
          <div className="interval-list">
            {intervalPositions.map(([position, values]) => (
              <div key={position}><AssetBadge position={position as Asset['position']} /><span><strong>{(values.coverage * 100).toFixed(1)}%</strong><small>{values.rows} held-out players · {values.mean_width.toFixed(1)} PPG wide</small></span></div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel model-table-card">
        <div className="panel-heading"><div><span className="eyebrow">Simple challengers</span><h2>Baseline comparison</h2></div><span className="method-note">Selected on validation, judged later</span></div>
        <div className="table-scroll">
          <table className="model-table">
            <thead><tr><th>Baseline</th><th>Validation MAE</th><th>Held-out MAE</th><th>Held-out rank</th></tr></thead>
            <tbody>
              {health.baselines.map((baseline) => (
                <tr key={baseline.id} className={baseline.selected ? 'selected' : ''}><td>{baselineLabels[baseline.id] ?? baseline.id}{baseline.selected && <small> strongest</small>}</td><td>{baseline.validation.mae.toFixed(2)}</td><td>{baseline.test.mae.toFixed(2)}</td><td>{baseline.test.rank_correlation.toFixed(3)}</td></tr>
              ))}
              <tr className="model-row"><td>Production model</td><td>—</td><td>{health.metrics.model.mae.toFixed(2)}</td><td>{health.metrics.model.rank_correlation.toFixed(3)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel model-table-card">
        <div className="panel-heading"><div><span className="eyebrow">Failure map</span><h2>Where the model helps—and where it doesn’t</h2></div><span className="method-note">Positive lift is better</span></div>
        <div className="table-scroll">
          <table className="model-table slice-table">
            <thead><tr><th>Slice</th><th>Players</th><th>Model MAE</th><th>Baseline MAE</th><th>Lift</th></tr></thead>
            <tbody>{importantSlices.map((slice) => (
              <tr key={slice.id}><td>{sliceLabels[slice.id] ?? slice.id}</td><td>{slice.rows}</td><td>{slice.model.mae.toFixed(2)}</td><td>{slice.baseline.mae.toFixed(2)}</td><td className={slice.maeImprovement >= 0 ? 'positive' : 'negative'}>{signedPercent(slice.maeImprovement)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="model-caveat panel"><Info size={17} /><span><strong>What this does not claim:</strong> production MAE improved{health.metrics.rankCorrelationDelta >= 0 ? ` and rank correlation improved by ${health.metrics.rankCorrelationDelta.toFixed(3)}` : ` while rank correlation trails the simple baseline by ${Math.abs(health.metrics.rankCorrelationDelta).toFixed(3)}`}. That is useful held-out evidence, not proof the model is universally smarter.</span></section>
    </main>
  )
}

function AppHeader({
  view,
  setView,
  leagueName,
  leagueId,
  inputId,
  setInputId,
  onSubmit,
  loading,
  savedLeagues,
}: {
  view: View
  setView: (view: View) => void
  leagueName: string
  leagueId: string
  inputId: string
  setInputId: (id: string) => void
  onSubmit: (event: FormEvent) => void
  loading: boolean
  savedLeagues: LeaguePreferences[]
}) {
  return (
    <>
      <header className="app-header">
        <button className="brand" type="button" onClick={() => setView('rankings')} aria-label="RosterLab home">
          <span className="brand-mark"><span>R</span></span>
          <span><strong>Roster</strong>Lab</span>
        </button>
        <nav aria-label="Primary navigation">
          <button type="button" className={view === 'rankings' ? 'active' : ''} onClick={() => setView('rankings')}>
            <BarChart3 size={17} /> Power rankings
          </button>
          <button type="button" className={view === 'trade' ? 'active' : ''} onClick={() => setView('trade')}>
            <ArrowLeftRight size={17} /> Trade lab
          </button>
          <button type="button" className={view === 'journal' ? 'active' : ''} onClick={() => setView('journal')}>
            <BookOpen size={17} /> Journal
          </button>
          <button type="button" className={view === 'intel' ? 'active' : ''} onClick={() => setView('intel')}>
            <Radar size={17} /> Intel
          </button>
          <button type="button" className={view === 'strategy' ? 'active' : ''} onClick={() => setView('strategy')}>
            <Handshake size={17} /> Strategy
          </button>
          <button type="button" className={view === 'model' ? 'active' : ''} onClick={() => setView('model')}>
            <CircleGauge size={17} /> Model
          </button>
        </nav>
        <form className="league-switcher" onSubmit={onSubmit}>
          <label>
            <small>{leagueName || 'Sleeper league'}</small>
            <input list="saved-sleeper-leagues" value={inputId} onChange={(event) => setInputId(event.target.value)} aria-label="Sleeper league ID" />
            <datalist id="saved-sleeper-leagues">
              {savedLeagues.map((preference) => <option key={preference.leagueId} value={preference.leagueId}>{preference.leagueName}</option>)}
            </datalist>
          </label>
          <button type="submit" disabled={loading || inputId === leagueId} aria-label="Sync league">
            <RefreshCw size={17} className={loading ? 'spin' : ''} />
          </button>
        </form>
      </header>
    </>
  )
}

function LeagueRibbon({ data }: { data: AppData }) {
  const { league } = data.leagueBundle
  const format = leagueFormat(data.leagueBundle)
  const tep = league.scoring_settings.bonus_rec_te ?? 0
  return (
    <div className="league-ribbon">
      <div className="ribbon-inner">
        <span className="ribbon-title"><span className="status-dot" /> {league.name}</span>
        <span>{league.season} Dynasty</span>
        <span>{format.numQbs === 2 ? 'Superflex' : '1QB'}</span>
        <span>{league.total_rosters} teams</span>
        <span>Full PPR{tep ? ` + ${tep} TEP` : ''}</span>
        {data.user && <span title={data.user.email}>Private for {data.user.name}</span>}
        <span className="ribbon-source">Powered by <a href="https://tradyr.app" target="_blank" rel="noreferrer">Tradyr</a></span>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <main className="loading-state">
      <div className="loading-mark"><span /></div>
      <span className="eyebrow">Syncing the war room</span>
      <h1>Pulling rosters, picks, and market values…</h1>
      <div className="loading-lines"><span /><span /><span /></div>
    </main>
  )
}

function ErrorState({ message, inputId, setInputId, onSubmit }: {
  message: string
  inputId: string
  setInputId: (id: string) => void
  onSubmit: (event: FormEvent) => void
}) {
  return (
    <main className="error-state">
      <div className="error-card panel">
        <span className="error-icon">!</span>
        <span className="eyebrow">Couldn’t load that league</span>
        <h1>Check the public Sleeper league ID.</h1>
        <p>{message}</p>
        <form onSubmit={onSubmit}>
          <input value={inputId} onChange={(event) => setInputId(event.target.value)} aria-label="Sleeper league ID" />
          <button type="submit">Try again <ChevronRight size={17} /></button>
        </form>
      </div>
    </main>
  )
}

function App() {
  const [view, setView] = useState<View>('rankings')
  const [mode, setMode] = useState<RankingMode>('overall')
  const [leagueId, setLeagueId] = useState(DEFAULT_LEAGUE_ID)
  const [inputId, setInputId] = useState(DEFAULT_LEAGUE_ID)
  const [data, setData] = useState<AppData | null>(null)
  const [selectedId, setSelectedId] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [journalSyncing, setJournalSyncing] = useState(false)
  const [userState, setUserState] = useState<UserState | null>(null)
  const initialLoad = useRef(false)

  const loadLeague = async (id: string, stateOverride: UserState | null = userState) => {
    const cleanId = id.trim()
    if (!/^\d+$/.test(cleanId)) {
      setError('Sleeper league IDs contain numbers only.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const leagueBundle = await fetchLeagueBundle(cleanId)
      const format = leagueFormat(leagueBundle)
      const [valueBundle, projectionBundle, modelHealth, eventModelHealth, storedJournal] = await Promise.all([
        fetchValues({
          ...format,
          numTeams: leagueBundle.league.total_rosters,
        }),
        fetchProjections(),
        fetchModelHealth(),
        fetchEventModelHealth(),
        fetchJournal(cleanId).catch(() => null),
      ])
      const journalFresh = storedJournal?.sync?.finishedAt
        && storedJournal.sync.status === 'complete'
        && Date.now() - Date.parse(storedJournal.sync.finishedAt) < 15 * 60 * 1000
      const journal = journalFresh
        ? storedJournal
        : await syncJournal(cleanId).catch(() => storedJournal ?? { trades: [], identities: [], snapshots: [], outcomes: [], sync: null })
      const rosterIds = new Set(leagueBundle.rosters.flatMap((roster) => roster.players ?? []))
      const sleeperPlayers = await fetchSleeperPlayers([...rosterIds])
      const playerProjections = new Map(
        Object.entries(projectionBundle?.projections ?? {}).map(([playerId, projection]) => [
          playerId,
          projectionBundle?.stale
            ? {
                ...projection,
                confidence: projection.confidence * 0.7,
                drivers: ['stale source snapshot', ...(projection.drivers ?? [])].slice(0, 3),
              }
            : projection,
        ]),
      )
      const teams = buildTeams(leagueBundle, valueBundle, sleeperPlayers, playerProjections)
      const transactions = journalTransactionsForCurrentManagers(journal, leagueBundle.league.league_id)
      const managerProfiles = buildManagerProfiles(transactions, teams, valueBundle.players, valueBundle.picks)
      const existingPreference = stateOverride?.preferences.find((item) => item.leagueId === cleanId)
      const basePreference: LeaguePreferences = {
        leagueId: cleanId,
        leagueName: leagueBundle.league.name,
        myRosterId: existingPreference?.myRosterId ?? null,
        watchlist: existingPreference?.watchlist ?? [],
        settings: existingPreference?.settings ?? {},
      }
      const saved = await saveLeaguePreferences(basePreference).catch(() => null)
      const preferences = saved?.preferences ?? basePreference
      const user = saved?.user ?? stateOverride?.user ?? null
      if (user) {
        const nextState: UserState = {
          user,
          preferences: [
            preferences,
            ...(stateOverride?.preferences ?? []).filter((item) => item.leagueId !== cleanId),
          ],
        }
        setUserState(nextState)
      }
      setData({ leagueBundle, valueBundle, teams, modelHealth, eventModelHealth, managerProfiles, journal, preferences, user })
      setMode(preferences.settings.rankingMode ?? 'overall')
      setLeagueId(cleanId)
      setInputId(cleanId)
      setSelectedId(teams[0]?.rosterId ?? 1)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unknown data error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initialLoad.current) return
    initialLoad.current = true
    void (async () => {
      const state = await fetchUserState()
      setUserState(state)
      const savedLeague = state?.preferences[0]?.leagueId ?? DEFAULT_LEAGUE_ID
      setInputId(savedLeague)
      await loadLeague(savedLeague, state)
    })()
  }, [])

  const updatePreferences = (patch: Partial<LeaguePreferences>) => {
    if (!data) return
    const next: LeaguePreferences = {
      ...data.preferences,
      ...patch,
      settings: {
        ...data.preferences.settings,
        ...(patch.settings ?? {}),
      },
    }
    setData({ ...data, preferences: next })
    void saveLeaguePreferences(next).then((saved) => {
      setData((current) => current && current.leagueBundle.league.league_id === next.leagueId
        ? { ...current, preferences: saved.preferences, user: saved.user }
        : current)
      setUserState((current) => ({
        user: saved.user,
        preferences: [saved.preferences, ...(current?.preferences ?? []).filter((item) => item.leagueId !== saved.preferences.leagueId)],
      }))
    }).catch(() => setError('Your private preferences could not be saved'))
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    void loadLeague(inputId)
  }

  const refreshJournal = async () => {
    if (!data || journalSyncing) return
    setJournalSyncing(true)
    try {
      const journal = await syncJournal(data.leagueBundle.league.league_id)
      const transactions = journalTransactionsForCurrentManagers(journal, data.leagueBundle.league.league_id)
      const managerProfiles = buildManagerProfiles(transactions, data.teams, data.valueBundle.players, data.valueBundle.picks)
      setData((current) => current ? { ...current, journal, managerProfiles } : current)
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Journal sync failed')
    } finally {
      setJournalSyncing(false)
    }
  }

  return (
    <div className="app">
      <AppHeader
        view={view}
        setView={setView}
        leagueName={data?.leagueBundle.league.name ?? ''}
        leagueId={leagueId}
        inputId={inputId}
        setInputId={setInputId}
        onSubmit={handleSubmit}
        loading={loading}
        savedLeagues={userState?.preferences ?? []}
      />
      {data && <LeagueRibbon data={data} />}
      {loading && !data ? (
        <LoadingState />
      ) : error && !data ? (
        <ErrorState message={error} inputId={inputId} setInputId={setInputId} onSubmit={handleSubmit} />
      ) : data ? (
        <>
          {error && <div className="inline-error">Sync failed: {error}. Showing the last loaded league.</div>}
          {view === 'rankings' ? (
            <RankingsView
              teams={data.teams}
              mode={mode}
              setMode={(nextMode) => {
                setMode(nextMode)
                updatePreferences({ settings: { rankingMode: nextMode } })
              }}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
            />
          ) : view === 'trade' ? (
            <TradeView teams={data.teams} rosterPositions={data.leagueBundle.league.roster_positions} />
          ) : view === 'journal' ? (
            <TradeJournalView journal={data.journal} syncing={journalSyncing} onSync={() => void refreshJournal()} />
          ) : view === 'intel' ? (
            <IntelView key={`intel-${data.leagueBundle.league.league_id}`} teams={data.teams} valueBundle={data.valueBundle} eventHealth={data.eventModelHealth} preferences={data.preferences} onUpdatePreferences={updatePreferences} />
          ) : view === 'strategy' ? (
            <StrategyView key={`strategy-${data.leagueBundle.league.league_id}`} teams={data.teams} profiles={data.managerProfiles} myRosterId={data.preferences.myRosterId ?? data.teams[0].rosterId} rosterPositions={data.leagueBundle.league.roster_positions} preferredRosterId={data.preferences.settings.strategyRosterId} onUpdatePreferences={updatePreferences} />
          ) : (
            <ModelView health={data.modelHealth} />
          )}
          <footer>
            <span>RosterLab <b>·</b> League-relative analysis</span>
            <span>Sleeper rosters + <a href="https://tradyr.app" target="_blank" rel="noreferrer">Tradyr</a> values + linked NFL reporting</span>
          </footer>
        </>
      ) : null}
    </div>
  )
}

export default App
