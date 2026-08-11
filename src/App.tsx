import { ArrowLeftRight, BarChart3, BookOpen, ChevronRight, CircleGauge, GraduationCap, Radar, RefreshCw, Target } from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { fetchEventModelHealth, fetchJournal, fetchLeagueBundle, fetchModelHealth, fetchPendingTransactions, fetchProjections, fetchRookieBoard, fetchSleeperPlayers, fetchUserState, fetchValues, saveLeaguePreferences, saveMarketTape, syncJournal } from './api'
import { buildEdgeBoard, buildTeamDirections, marketTapeAssets } from './edge'
import type { TeamDirection } from './edge'
import { journalTransactionsForCurrentManagers } from './journal'
import { buildManagerProfiles } from './negotiation'
import type { ManagerProfile } from './negotiation'
import { createManualPendingTrade, manualPendingTradeFingerprint, manualTradeAlreadySettled, manualTradeRejectedBySleeper, mergePendingTrades, projectPendingTrades } from './pending-trades'
import type { PendingTradeProjection } from './pending-trades'
import { buildTeams, leagueFormat } from './rankings'
import { resolveTeamStrategy } from './strategy'
import type { RookieBoardBundle } from './rookies'
import type { Asset, EventModelHealthBundle, JournalBundle, LeagueBundle, LeaguePreferences, ModelHealthBundle, RankingMode, SleeperTransaction, Team, UserState, ValueBundle } from './types'
import { EdgeView } from './views/EdgeView'
import { IntelView } from './views/IntelView'
import { ModelView } from './views/ModelView'
import { RankingsView } from './views/RankingsView'
import { RookieBoardView } from './views/RookieBoardView'
import { TradeJournalView } from './views/TradeJournalView'
import { TradeView } from './views/TradeView'
import type { TradeDraft } from './views/types'

const DEFAULT_LEAGUE_ID = '1336087922847289344'
const QUICK_LEAGUES = [
  { id: DEFAULT_LEAGUE_ID, label: 'BC League' },
  { id: '1312112570039037952', label: 'Emperor Phil’s' },
] as const

type AppData = {
  leagueBundle: LeagueBundle
  valueBundle: ValueBundle
  settledTeams: Team[]
  teams: Team[]
  availableTeams: Team[]
  officialPendingTransactions: SleeperTransaction[]
  pendingProjection: PendingTradeProjection
  pendingFetchFailedRounds: number[]
  modelHealth: ModelHealthBundle | null
  eventModelHealth: EventModelHealthBundle | null
  rookieBoard: RookieBoardBundle | null
  managerProfiles: ManagerProfile[]
  directions: TeamDirection[]
  journal: JournalBundle
  preferences: LeaguePreferences
}

type View = 'rankings' | 'trade' | 'journal' | 'intel' | 'strategy' | 'rookies' | 'model'

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
            <BarChart3 size={17} /> League facts
          </button>
          <button type="button" className={view === 'trade' ? 'active' : ''} onClick={() => setView('trade')}>
            <ArrowLeftRight size={17} /> Trade lab
          </button>
          <button type="button" className={view === 'journal' ? 'active' : ''} onClick={() => setView('journal')}>
            <BookOpen size={17} /> Journal
          </button>
          <button type="button" className={view === 'intel' ? 'active' : ''} onClick={() => setView('intel')}>
            <Radar size={17} /> News
          </button>
          <button type="button" className={view === 'strategy' ? 'active' : ''} onClick={() => setView('strategy')}>
            <Target size={17} /> Evidence
          </button>
          <button type="button" className={view === 'rookies' ? 'active' : ''} onClick={() => setView('rookies')}>
            <GraduationCap size={17} /> Rookie board
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
          <button type="submit" disabled={loading} aria-label={inputId === leagueId ? 'Refresh league' : 'Sync league'}>
            <RefreshCw size={17} className={loading ? 'spin' : ''} />
          </button>
        </form>
      </header>
    </>
  )
}

function LeagueRibbon({ data, loading, onSelectLeague }: {
  data: AppData
  loading: boolean
  onSelectLeague: (leagueId: string) => void
}) {
  const { league } = data.leagueBundle
  const format = leagueFormat(data.leagueBundle)
  const tep = league.scoring_settings.bonus_rec_te ?? 0
  return (
    <div className="league-ribbon">
      <div className="ribbon-inner">
        <span className="ribbon-title"><span className="status-dot" /> {league.name}</span>
        <div className="league-quick-switch" role="group" aria-label="Quick league switcher">
          {QUICK_LEAGUES.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={league.league_id === preset.id ? 'active' : ''}
              aria-pressed={league.league_id === preset.id}
              title={`${preset.label} league (${preset.id})`}
              disabled={loading}
              onClick={() => onSelectLeague(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <span>{league.season} Dynasty</span>
        <span>{format.numQbs === 2 ? 'Superflex' : '1QB'}</span>
        <span>{league.total_rosters} teams</span>
        <span>Full PPR{tep ? ` + ${tep} TEP` : ''}</span>
        {data.pendingProjection.activeTrades.length > 0 && <span>{data.pendingProjection.activeTrades.length} accepted trade{data.pendingProjection.activeTrades.length === 1 ? '' : 's'} projected</span>}
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
  const [tradeDraft, setTradeDraft] = useState<TradeDraft | null>(null)
  const [rosterSnapshot, setRosterSnapshot] = useState<'settled' | 'committed'>('committed')
  const initialLoad = useRef(false)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [view, leagueId])

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
      const existingPreference = stateOverride?.preferences.find((item) => item.leagueId === cleanId)
      const [valueBundle, projectionBundle, modelHealth, eventModelHealth, rookieBoard, storedJournal, pendingFetch] = await Promise.all([
        fetchValues({
          ...format,
          numTeams: leagueBundle.league.total_rosters,
        }),
        fetchProjections(),
        fetchModelHealth(),
        fetchEventModelHealth(),
        fetchRookieBoard().catch(() => null),
        fetchJournal(cleanId).catch(() => null),
        fetchPendingTransactions(leagueBundle.league),
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
        projectionBundle?.stale ? [] : Object.entries(projectionBundle?.projections ?? {}),
      )
      const settledTeams = buildTeams(leagueBundle, valueBundle, sleeperPlayers, playerProjections)
      const manualPendingTrades = (existingPreference?.settings.pendingTrades ?? [])
        .filter((trade) => (
          !manualTradeAlreadySettled(trade, leagueBundle)
          && !manualTradeRejectedBySleeper(trade, pendingFetch.transactions)
        ))
      const pendingProjection = projectPendingTrades(
        settledTeams,
        mergePendingTrades(pendingFetch.transactions, manualPendingTrades),
        leagueBundle.league.roster_positions,
      )
      const transactions = journalTransactionsForCurrentManagers(journal, leagueBundle.league.league_id)
      const teams = pendingProjection.committedTeams
      const directions = buildTeamDirections({
        teams,
        transactions,
        picks: valueBundle.picks,
        overrides: existingPreference?.settings.teamDirectionOverrides,
      })
      const managerProfiles = buildManagerProfiles(transactions, teams, valueBundle.players, valueBundle.picks)
      const authenticatedHandle = stateOverride?.user.email.split('@')[0]?.toLowerCase()
      const inferredRosterId = authenticatedHandle
        ? teams.find((team) => team.ownerName.toLowerCase() === authenticatedHandle || team.ownerName.toLowerCase().startsWith(authenticatedHandle))?.rosterId ?? null
        : null
      const basePreference: LeaguePreferences = {
        leagueId: cleanId,
        leagueName: leagueBundle.league.name,
        myRosterId: existingPreference?.myRosterId ?? inferredRosterId,
        watchlist: existingPreference?.watchlist ?? [],
        settings: { ...(existingPreference?.settings ?? {}), pendingTrades: manualPendingTrades },
      }
      const initialRosterId = basePreference.myRosterId ?? teams[0]?.rosterId
      const initialTeam = teams.find((team) => team.rosterId === initialRosterId) ?? teams[0]
      if (initialTeam && !basePreference.settings.teamStrategy) {
        const inferred = resolveTeamStrategy(initialTeam)
        basePreference.settings.teamStrategy = {
          mode: 'auto',
          horizonYears: inferred.horizonYears,
          flipPriority: inferred.flipPriority,
        }
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
      setData({
        leagueBundle,
        valueBundle,
        settledTeams,
        teams,
        availableTeams: pendingProjection.availableTeams,
        officialPendingTransactions: pendingFetch.transactions,
        pendingProjection,
        pendingFetchFailedRounds: pendingFetch.failedRounds,
        modelHealth,
        eventModelHealth,
        rookieBoard,
        managerProfiles,
        directions,
        journal,
        preferences,
      })
      const seedRosterId = preferences.myRosterId ?? teams[0]?.rosterId
      if (seedRosterId) {
        const seedTeam = teams.find((team) => team.rosterId === seedRosterId) ?? teams[0]
        const seedStrategy = resolveTeamStrategy(seedTeam, preferences.settings.teamStrategy)
        const seedOpportunities = buildEdgeBoard(teams, {
          myRosterId: seedRosterId,
          rosterPositions: leagueBundle.league.roster_positions,
          directions,
          excludedAssetIds: pendingProjection.lockedAssetIds,
          maxResults: 500,
        })
        void saveMarketTape(cleanId, {
          assets: marketTapeAssets(teams, seedOpportunities, seedStrategy),
          format: { ...format, numTeams: leagueBundle.league.total_rosters },
          sourceVersion: valueBundle.meta.generatedAt,
        }).catch(() => undefined)
      }
      setMode(preferences.settings.rankingMode ?? 'overall')
      setLeagueId(cleanId)
      setInputId(cleanId)
      setSelectedId(teams[0]?.rosterId ?? 1)
      setTradeDraft(null)
      setRosterSnapshot(pendingProjection.activeTrades.length ? 'committed' : 'settled')
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
    let nextData: AppData = { ...data, preferences: next }
    const pendingChanged = Boolean(patch.settings && Object.prototype.hasOwnProperty.call(patch.settings, 'pendingTrades'))
    if (pendingChanged) {
      const pendingProjection = projectPendingTrades(
        data.settledTeams,
        mergePendingTrades(data.officialPendingTransactions, next.settings.pendingTrades ?? []),
        data.leagueBundle.league.roster_positions,
      )
      nextData = {
        ...nextData,
        teams: pendingProjection.committedTeams,
        availableTeams: pendingProjection.availableTeams,
        pendingProjection,
      }
      setRosterSnapshot(pendingProjection.activeTrades.length ? 'committed' : 'settled')
    }
    if (pendingChanged || (patch.settings && Object.prototype.hasOwnProperty.call(patch.settings, 'teamDirectionOverrides'))) {
      const transactions = journalTransactionsForCurrentManagers(data.journal, data.leagueBundle.league.league_id)
      const teams = nextData.teams
      const directions = buildTeamDirections({
        teams,
        transactions,
        picks: data.valueBundle.picks,
        overrides: next.settings.teamDirectionOverrides,
      })
      nextData = {
        ...nextData,
        teams,
        directions,
        managerProfiles: buildManagerProfiles(transactions, teams, data.valueBundle.players, data.valueBundle.picks),
      }
    }
    setData(nextData)
    void saveLeaguePreferences(next).then((saved) => {
      setData((current) => current && current.leagueBundle.league.league_id === next.leagueId
        ? { ...current, preferences: saved.preferences }
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

  const selectLeague = (nextLeagueId: string) => {
    setInputId(nextLeagueId)
    if (nextLeagueId !== leagueId) void loadLeague(nextLeagueId)
  }

  const openTradeDraft = (draft: Omit<TradeDraft, 'nonce'>) => {
    setTradeDraft({ ...draft, nonce: Date.now() })
    setView('trade')
  }

  const commitPendingTrade = (input: { teamAId: number; teamBId: number; sideA: Asset[]; sideB: Asset[] }) => {
    if (!data) return
    const pending = createManualPendingTrade(input)
    const existing = data.preferences.settings.pendingTrades ?? []
    if (existing.some((trade) => manualPendingTradeFingerprint(trade) === manualPendingTradeFingerprint(pending))) return
    updatePreferences({
      settings: {
        pendingTrades: [...existing, pending].slice(-12),
      },
    })
  }

  const cancelPendingTrade = (manualId: string) => {
    if (!data) return
    updatePreferences({
      settings: {
        pendingTrades: (data.preferences.settings.pendingTrades ?? []).filter((trade) => trade.id !== manualId),
      },
    })
  }

  const refreshJournal = async () => {
    if (!data || journalSyncing) return
    setJournalSyncing(true)
    try {
      const journal = await syncJournal(data.leagueBundle.league.league_id)
      setData((current) => {
        if (!current) return current
        const transactions = journalTransactionsForCurrentManagers(journal, current.leagueBundle.league.league_id)
        const teams = current.teams
        const directions = buildTeamDirections({ teams, transactions, picks: current.valueBundle.picks, overrides: current.preferences.settings.teamDirectionOverrides })
        return { ...current, journal, teams, directions, managerProfiles: buildManagerProfiles(transactions, teams, current.valueBundle.players, current.valueBundle.picks) }
      })
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
      {data && <LeagueRibbon data={data} loading={loading} onSelectLeague={selectLeague} />}
      {loading && !data ? (
        <LoadingState />
      ) : error && !data ? (
        <ErrorState message={error} inputId={inputId} setInputId={setInputId} onSubmit={handleSubmit} />
      ) : data ? (
        <>
          {error && <div className="inline-error">Sync failed: {error}. Showing the last loaded league.</div>}
          {view === 'rankings' ? (
            <RankingsView
              teams={rosterSnapshot === 'committed' ? data.teams : data.settledTeams}
              settledTeams={data.settledTeams}
              pendingProjection={data.pendingProjection}
              pendingFetchFailedRounds={data.pendingFetchFailedRounds}
              rosterSnapshot={rosterSnapshot}
              setRosterSnapshot={setRosterSnapshot}
              onCancelPending={cancelPendingTrade}
              mode={mode}
              setMode={(nextMode) => {
                setMode(nextMode)
                updatePreferences({ settings: { rankingMode: nextMode } })
              }}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
            />
          ) : view === 'trade' ? (
            <TradeView
              key={`trade-${data.leagueBundle.league.league_id}-${tradeDraft?.nonce ?? 'manual'}`}
              teams={data.availableTeams}
              contextTeams={data.teams}
              pendingTradeCount={data.pendingProjection.activeTrades.length}
              rosterPositions={data.leagueBundle.league.roster_positions}
              initialDraft={tradeDraft}
              strategyRosterId={data.preferences.myRosterId ?? data.teams[0].rosterId}
              strategy={resolveTeamStrategy(
                data.teams.find((team) => team.rosterId === (data.preferences.myRosterId ?? data.teams[0].rosterId)) ?? data.teams[0],
                data.preferences.settings.teamStrategy,
              )}
              onStrategyChange={(teamStrategy) => updatePreferences({ settings: { teamStrategy } })}
              onCommitPendingTrade={commitPendingTrade}
            />
          ) : view === 'journal' ? (
            <TradeJournalView journal={data.journal} syncing={journalSyncing} onSync={() => void refreshJournal()} />
          ) : view === 'intel' ? (
            <IntelView key={`intel-${data.leagueBundle.league.league_id}`} teams={data.teams} valueBundle={data.valueBundle} eventHealth={data.eventModelHealth} preferences={data.preferences} onUpdatePreferences={updatePreferences} />
          ) : view === 'strategy' ? (
            <EdgeView key={`edge-${data.leagueBundle.league.league_id}`} teams={data.teams} lockedAssetIds={data.pendingProjection.lockedAssetIds} profiles={data.managerProfiles} directions={data.directions} myRosterId={data.preferences.myRosterId ?? data.teams[0].rosterId} rosterPositions={data.leagueBundle.league.roster_positions} valueBundle={data.valueBundle} journal={data.journal} preferences={data.preferences} marketFormat={{ ...leagueFormat(data.leagueBundle), numTeams: data.leagueBundle.league.total_rosters }} onUpdatePreferences={updatePreferences} onOpenTrade={openTradeDraft} journalSyncing={journalSyncing} onSyncJournal={() => void refreshJournal()} onOpenJournal={() => setView('journal')} />
          ) : view === 'rookies' ? (
            <RookieBoardView bundle={data.rookieBoard} />
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
