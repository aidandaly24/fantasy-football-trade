import {
  ArrowLeftRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleGauge,
  Info,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { fetchLeagueBundle, fetchMissingPlayers, fetchValues } from './api'
import { buildTeams, evaluateTrade, leagueFormat } from './rankings'
import type { Asset, LeagueBundle, RankingMode, Team, ValueBundle } from './types'

const DEFAULT_LEAGUE_ID = '1336087922847289344'

type AppData = {
  leagueBundle: LeagueBundle
  valueBundle: ValueBundle
  teams: Team[]
}

type View = 'rankings' | 'trade'

const modeCopy: Record<RankingMode, { label: string; description: string }> = {
  overall: {
    label: 'Overall',
    description: 'Balanced blend of lineup, dynasty core, depth, and draft capital.',
  },
  contender: {
    label: 'Contender',
    description: 'Weights the best legal starting lineup and playable depth most heavily.',
  },
  future: {
    label: 'Future',
    description: 'Weights dynasty core value and owned rookie picks most heavily.',
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

function getTeamWindow(team: Team, teams: Team[]) {
  const contenderRank = [...teams]
    .sort((a, b) => b.metrics.contender - a.metrics.contender)
    .findIndex((item) => item.rosterId === team.rosterId)
  const futureRank = [...teams]
    .sort((a, b) => b.metrics.future - a.metrics.future)
    .findIndex((item) => item.rosterId === team.rosterId)

  if (contenderRank <= 2 && futureRank <= 5) return ['All-in window', 'The roster can contend without mortgaging its full future.']
  if (contenderRank <= 3) return ['Win-now', 'Lineup strength is the advantage; protect it in 2-for-1 deals.']
  if (futureRank <= 3) return ['Ascending', 'Young core and capital point toward the next competitive window.']
  if (team.metrics.picks >= 75) return ['Reloading', 'Draft capital is the cleanest path back toward the top half.']
  return ['At a crossroads', 'Look for value-neutral moves that improve the starting lineup.']
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
  const [windowLabel, windowCopy] = getTeamWindow(team, teams)
  const topAssets = [...team.players, ...team.picks].sort((a, b) => b.value - a.value).slice(0, 6)
  const rank = [...teams]
    .sort((a, b) => b.metrics.overall - a.metrics.overall)
    .findIndex((item) => item.rosterId === team.rosterId) + 1

  return (
    <aside className="team-scout panel">
      <div className="scout-hero">
        <div className="scout-topline">
          <span className="window-pill"><Sparkles size={14} /> {windowLabel}</span>
          <span className="overall-rank">#{rank} overall</span>
        </div>
        <div className="scout-identity">
          <Avatar team={team} size="lg" />
          <div>
            <h2>{team.teamName}</h2>
            <p>Managed by {team.ownerName}</p>
          </div>
        </div>
        <p className="window-copy">{windowCopy}</p>
      </div>

      <div className="scout-section metrics-grid">
        <MetricBar label="Starting lineup" value={team.metrics.lineup} />
        <MetricBar label="Dynasty core" value={team.metrics.core} />
        <MetricBar label="Bench depth" value={team.metrics.depth} />
        <MetricBar label="Draft capital" value={team.metrics.picks} />
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
                      : 'Mid-pick estimate'}
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
            ? [asset.team, asset.rank ? `#${asset.rank} overall` : 'Unranked'].filter(Boolean).join(' · ')
            : asset.slot
              ? 'Known slot'
              : 'Projected mid-round'}
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

function TradeVerdict({ sideA, sideB }: { sideA: Asset[]; sideB: Asset[] }) {
  const result = evaluateTrade(sideA, sideB)
  const lead = result.valueA === result.valueB ? 'even' : result.valueA > result.valueB ? 'a' : 'b'
  return (
    <section className="trade-verdict panel">
      <div className={`verdict-orb verdict-${lead}`}>
        <CircleGauge size={23} />
        <span>{result.verdict}</span>
      </div>
      <div className="value-versus">
        <span><small>Side A</small><strong>{formatValue(result.valueA)}</strong></span>
        <b>vs</b>
        <span><small>Side B</small><strong>{formatValue(result.valueB)}</strong></span>
      </div>
      <div className="fairness-scale">
        <span className="scale-labels"><small>A wins</small><small>Fair zone</small><small>B wins</small></span>
        <div className="scale-track">
          <span className="fair-zone" />
          <i style={{ left: `${Math.max(2, Math.min(98, 100 - result.shareA))}%` }} />
        </div>
      </div>
      <p className="verdict-copy">
        {sideA.length === 0 || sideB.length === 0
          ? 'Select at least one asset on each side to get a market verdict.'
          : result.fair
            ? `Only ${result.difference.toFixed(1)}% separates the adjusted packages. This is a credible opening offer.`
            : `${result.difference.toFixed(1)}% separates the adjusted packages after consolidation value.`}
      </p>
      <div className="model-note">
        <Info size={16} />
        <span>Extra pieces receive diminishing weight, so one premium asset is not treated like a pile of roster fillers.</span>
      </div>
    </section>
  )
}

function RosterImpact({
  teamA,
  teamB,
  sideA,
  sideB,
}: {
  teamA: Team
  teamB: Team
  sideA: Asset[]
  sideB: Asset[]
}) {
  const value = evaluateTrade(sideA, sideB)
  const netA = value.valueB - value.valueA
  const netB = -netA
  const topA = [...sideA].sort((a, b) => b.value - a.value)[0]
  const topB = [...sideB].sort((a, b) => b.value - a.value)[0]
  const spotsA = sideA.length - sideB.length

  const rows = [
    { label: 'Adjusted market value', a: netA, b: netB, suffix: '' },
    { label: 'Roster spots opened', a: spotsA, b: -spotsA, suffix: '' },
  ]

  return (
    <section className="impact-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Deal context</span>
          <h2>What changes after the trade</h2>
        </div>
        <span className="method-note">Market view, not a projection</span>
      </div>
      <div className="impact-grid">
        <div className="impact-team-name"><Avatar team={teamA} size="sm" /><span><small>Side A</small><strong>{teamA.teamName}</strong></span></div>
        <span className="impact-spacer" />
        <div className="impact-team-name align-right"><span><small>Side B</small><strong>{teamB.teamName}</strong></span><Avatar team={teamB} size="sm" /></div>
        {rows.map((row) => (
          <div className="impact-row" key={row.label}>
            <b className={row.a > 0 ? 'positive' : row.a < 0 ? 'negative' : ''}>{row.a > 0 ? '+' : ''}{formatValue(row.a)}{row.suffix}</b>
            <span>{row.label}</span>
            <b className={row.b > 0 ? 'positive' : row.b < 0 ? 'negative' : ''}>{row.b > 0 ? '+' : ''}{formatValue(row.b)}{row.suffix}</b>
          </div>
        ))}
        <div className="impact-row">
          <b>{topB?.name ?? '—'}</b>
          <span>Best asset received</span>
          <b>{topA?.name ?? '—'}</b>
        </div>
      </div>
    </section>
  )
}

function TradeView({ teams }: { teams: Team[] }) {
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
          <p>Consensus dynasty value with a consolidation adjustment for multi-asset packages.</p>
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
        <TradeVerdict sideA={assetsA} sideB={assetsB} />
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

      <RosterImpact teamA={teamA} teamB={teamB} sideA={assetsA} sideB={assetsB} />
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
}: {
  view: View
  setView: (view: View) => void
  leagueName: string
  leagueId: string
  inputId: string
  setInputId: (id: string) => void
  onSubmit: (event: FormEvent) => void
  loading: boolean
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
        </nav>
        <form className="league-switcher" onSubmit={onSubmit}>
          <label>
            <small>{leagueName || 'Sleeper league'}</small>
            <input value={inputId} onChange={(event) => setInputId(event.target.value)} aria-label="Sleeper league ID" />
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
  const initialLoad = useRef(false)

  const loadLeague = async (id: string) => {
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
      const valueBundle = await fetchValues({
        ...format,
        numTeams: leagueBundle.league.total_rosters,
      })
      const knownIds = new Set(
        valueBundle.players.map((player) => player.sleeperId).filter((id): id is string => Boolean(id)),
      )
      const rosterIds = new Set(leagueBundle.rosters.flatMap((roster) => roster.players ?? []))
      const missingIds = [...rosterIds].filter((id) => !knownIds.has(id))
      const sleeperPlayers = await fetchMissingPlayers(missingIds)
      const teams = buildTeams(leagueBundle, valueBundle, sleeperPlayers)
      setData({ leagueBundle, valueBundle, teams })
      setLeagueId(cleanId)
      setInputId(cleanId)
      setSelectedId(teams[0]?.rosterId ?? 1)
      window.localStorage.setItem('rosterlab:leagueId', cleanId)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unknown data error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initialLoad.current) return
    initialLoad.current = true
    const saved = window.localStorage.getItem('rosterlab:leagueId') || DEFAULT_LEAGUE_ID
    setInputId(saved)
    void loadLeague(saved)
  }, [])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    void loadLeague(inputId)
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
              setMode={setMode}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
            />
          ) : (
            <TradeView teams={data.teams} />
          )}
          <footer>
            <span>RosterLab <b>·</b> League-relative analysis</span>
            <span>Sleeper rosters + <a href="https://tradyr.app" target="_blank" rel="noreferrer">Tradyr</a> composite market values</span>
          </footer>
        </>
      ) : null}
    </div>
  )
}

export default App
