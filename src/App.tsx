import { ArrowLeftRight, BarChart3, BookOpen, CircleGauge, GraduationCap, Radar, RefreshCw, Target } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { fetchEventModelHealth, fetchJournal, fetchLeagueBundle, fetchModelHealth, fetchProjections, fetchRookieBoard, fetchSleeperPlayers, fetchUserState, fetchValues, saveLeaguePreferences, syncJournal } from './api'
import { buildTeamDirections } from './edge'
import type { TeamDirection } from './edge'
import { journalTransactionsForCurrentManagers } from './journal'
import { isSupportedLeagueId, leagueContext, projectionForLeague, SUPPORTED_LEAGUES } from './league-context'
import type { LeagueContext, SupportedLeagueId } from './league-context'
import { buildManagerProfiles } from './negotiation'
import type { ManagerProfile } from './negotiation'
import { buildTeams } from './rankings'
import { resolveTeamStrategy } from './strategy'
import type { RookieBoardBundle } from './rookies'
import type { EventModelHealthBundle, JournalBundle, LeagueBundle, LeaguePreferences, ModelHealthBundle, PlayerProjection, RankingMode, Team, UserState, ValueBundle } from './types'
import { RankingsView } from './views/RankingsView'
import type { TradeDraft } from './views/types'

const EdgeView = lazy(() => import('./views/EdgeView').then((module) => ({ default: module.EdgeView })))
const IntelView = lazy(() => import('./views/IntelView').then((module) => ({ default: module.IntelView })))
const ModelView = lazy(() => import('./views/ModelView').then((module) => ({ default: module.ModelView })))
const RookieBoardView = lazy(() => import('./views/RookieBoardView').then((module) => ({ default: module.RookieBoardView })))
const TradeJournalView = lazy(() => import('./views/TradeJournalView').then((module) => ({ default: module.TradeJournalView })))
const TradeView = lazy(() => import('./views/TradeView').then((module) => ({ default: module.TradeView })))

const DEFAULT_LEAGUE_ID: SupportedLeagueId = SUPPORTED_LEAGUES[0].id
const LAST_LEAGUE_KEY = 'rosterlab:last-league'

type AppData = {
  leagueBundle: LeagueBundle
  leagueContext: LeagueContext
  valueBundle: ValueBundle
  playerProjections: Map<string, PlayerProjection>
  playerMetadataLoaded: boolean
  teams: Team[]
  modelHealth: ModelHealthBundle | null | undefined
  eventModelHealth: EventModelHealthBundle | null | undefined
  rookieBoard: RookieBoardBundle | null | undefined
  managerProfiles: ManagerProfile[]
  directions: TeamDirection[]
  journal: JournalBundle
  journalLoaded: boolean
  preferences: LeaguePreferences
}

type View = 'rankings' | 'trade' | 'journal' | 'intel' | 'strategy' | 'rookies' | 'model'

const EMPTY_JOURNAL: JournalBundle = {
  trades: [],
  identities: [],
  snapshots: [],
  outcomes: [],
  sync: null,
}

function AppHeader({
  view,
  setView,
}: {
  view: View
  setView: (view: View) => void
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
        <span className="private-app-scope">Two private leagues</span>
      </header>
    </>
  )
}

function LeagueRibbon({ data, loading, onSelectLeague }: {
  data: AppData
  loading: boolean
  onSelectLeague: (leagueId: SupportedLeagueId) => void
}) {
  const { league } = data.leagueBundle
  const context = data.leagueContext
  return (
    <div className="league-ribbon">
      <div className="ribbon-inner">
        <span className="ribbon-title"><span className="status-dot" /> {league.name}</span>
        <div className="league-quick-switch" role="group" aria-label="Quick league switcher">
          {SUPPORTED_LEAGUES.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={league.league_id === preset.id ? 'active' : ''}
              aria-pressed={league.league_id === preset.id}
              title={league.league_id === preset.id ? `Refresh ${preset.label}` : `Switch to ${preset.label}`}
              disabled={loading}
              onClick={() => onSelectLeague(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <span>{league.season} Dynasty</span>
        <span>{context.marketFormat.numQbs === 2 ? 'Superflex' : '1QB'}</span>
        <span>{league.total_rosters} teams</span>
        <span>{context.scoring.receptionPpr}-PPR + {context.scoring.tePremiumPerReception} TEP</span>
        <span>{context.roster.skillStartingSlots} skill starters · {context.roster.benchSlots} bench</span>
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

function ViewLoading({ label }: { label: string }) {
  return (
    <main className="loading-state">
      <div className="loading-mark"><span /></div>
      <span className="eyebrow">Opening this desk</span>
      <h1>{label}</h1>
      <div className="loading-lines"><span /><span /><span /></div>
    </main>
  )
}

function ErrorState({ message, onRetry, loading }: {
  message: string
  onRetry: () => void
  loading: boolean
}) {
  return (
    <main className="error-state">
      <div className="error-card panel">
        <span className="error-icon">!</span>
        <span className="eyebrow">Couldn’t load the selected league</span>
        <h1>The fixed league configuration could not sync.</h1>
        <p>{message}</p>
        <button type="button" onClick={onRetry} disabled={loading}>Try again <RefreshCw size={17} className={loading ? 'spin' : ''} /></button>
      </div>
    </main>
  )
}

function App() {
  const [view, setView] = useState<View>('rankings')
  const [mode, setMode] = useState<RankingMode>('overall')
  const [leagueId, setLeagueId] = useState<SupportedLeagueId>(DEFAULT_LEAGUE_ID)
  const [data, setData] = useState<AppData | null>(null)
  const [selectedId, setSelectedId] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [journalSyncing, setJournalSyncing] = useState(false)
  const [userState, setUserState] = useState<UserState | null>(null)
  const [tradeDraft, setTradeDraft] = useState<TradeDraft | null>(null)
  const initialLoad = useRef(false)
  const secondaryLoads = useRef(new Set<string>())

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [view, leagueId])

  const loadLeague = async (
    id: SupportedLeagueId,
    stateOverride: UserState | null = userState,
    prefetchedLeague?: Promise<LeagueBundle>,
  ) => {
    setLoading(true)
    setError(null)
    ;['rookies', 'model', 'event-model', 'journal', 'players'].forEach((kind) => secondaryLoads.current.delete(`${id}:${kind}`))
    try {
      const leagueBundle = await (prefetchedLeague ?? fetchLeagueBundle(id))
      const context = leagueContext(leagueBundle)
      const existingPreference = stateOverride?.preferences.find((item) => item.leagueId === id)
      const [valueBundle, projectionBundle] = await Promise.all([
        fetchValues({
          ...context.marketFormat,
        }),
        fetchProjections(),
      ])
      const playerProjections = new Map(projectionBundle?.stale ? [] : Object.entries(projectionBundle?.projections ?? {})
        .map(([playerId, projection]) => [playerId, projectionForLeague(projection, context)] as const))
      const teams = buildTeams(leagueBundle, valueBundle, new Map(), playerProjections)
      const transactions = journalTransactionsForCurrentManagers(EMPTY_JOURNAL, leagueBundle.league.league_id)
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
        leagueId: id,
        leagueName: leagueBundle.league.name,
        myRosterId: existingPreference?.myRosterId ?? inferredRosterId,
        watchlist: existingPreference?.watchlist ?? [],
        settings: { ...(existingPreference?.settings ?? {}) },
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
      setData({
        leagueBundle,
        leagueContext: context,
        valueBundle,
        playerProjections,
        playerMetadataLoaded: false,
        teams,
        modelHealth: undefined,
        eventModelHealth: undefined,
        rookieBoard: undefined,
        managerProfiles,
        directions,
        journal: EMPTY_JOURNAL,
        journalLoaded: false,
        preferences: basePreference,
      })
      setMode(basePreference.settings.rankingMode ?? 'overall')
      setLeagueId(id)
      try { window.localStorage.setItem(LAST_LEAGUE_KEY, id) } catch { /* Device storage is an optional acceleration only. */ }
      setSelectedId(teams[0]?.rosterId ?? 1)
      setTradeDraft(null)

      void saveLeaguePreferences(basePreference).then((saved) => {
        setData((current) => current?.leagueBundle.league.league_id === id
          ? { ...current, preferences: saved.preferences }
          : current)
        setUserState((current) => ({
          user: saved.user,
          preferences: [saved.preferences, ...(current?.preferences ?? []).filter((item) => item.leagueId !== id)],
        }))
      }).catch(() => undefined)

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
      let localLeague: SupportedLeagueId | null = null
      try {
        const storedLeague = window.localStorage.getItem(LAST_LEAGUE_KEY)
        if (isSupportedLeagueId(storedLeague)) localLeague = storedLeague
      } catch {
        // Hosted preferences remain the source of truth when device storage is unavailable.
      }
      const statePromise = fetchUserState()
      const leaguePromise = localLeague ? fetchLeagueBundle(localLeague) : null
      const state = await statePromise
      setUserState(state)
      const savedLeagueId = state?.preferences.find((item) => isSupportedLeagueId(item.leagueId))?.leagueId
      const savedLeague = localLeague ?? (isSupportedLeagueId(savedLeagueId) ? savedLeagueId : DEFAULT_LEAGUE_ID)
      await loadLeague(savedLeague, state, leaguePromise ?? undefined)
    })()
  }, [])

  useEffect(() => {
    if (!data) return
    const activeLeagueId = data.leagueBundle.league.league_id
    const startOnce = (kind: string, work: () => Promise<void>) => {
      const key = `${activeLeagueId}:${kind}`
      if (secondaryLoads.current.has(key)) return
      secondaryLoads.current.add(key)
      void work()
    }

    if (view === 'rookies' && data.rookieBoard === undefined) {
      startOnce('rookies', async () => {
        const rookieBoard = await fetchRookieBoard().catch(() => null)
        setData((current) => current?.leagueBundle.league.league_id === activeLeagueId
          ? { ...current, rookieBoard }
          : current)
      })
    }
    if (view === 'model' && data.modelHealth === undefined) {
      startOnce('model', async () => {
        const modelHealth = await fetchModelHealth()
        setData((current) => current?.leagueBundle.league.league_id === activeLeagueId
          ? { ...current, modelHealth }
          : current)
      })
    }
    if (view === 'intel' && data.eventModelHealth === undefined) {
      startOnce('event-model', async () => {
        const eventModelHealth = await fetchEventModelHealth()
        setData((current) => current?.leagueBundle.league.league_id === activeLeagueId
          ? { ...current, eventModelHealth }
          : current)
      })
    }
    if ((view === 'trade' || view === 'strategy') && !data.playerMetadataLoaded) {
      startOnce('players', async () => {
        const rosterIds = data.leagueBundle.rosters.flatMap((roster) => roster.players ?? [])
        const sleeperPlayers = await fetchSleeperPlayers(rosterIds).catch(() => null)
        if (!sleeperPlayers) return
        setData((current) => {
          if (!current || current.leagueBundle.league.league_id !== activeLeagueId) return current
          const enrichedTeams = buildTeams(
            current.leagueBundle,
            current.valueBundle,
            sleeperPlayers,
            current.playerProjections,
          )
          const transactions = journalTransactionsForCurrentManagers(current.journal, activeLeagueId)
          return {
            ...current,
            playerMetadataLoaded: true,
            teams: enrichedTeams,
            directions: buildTeamDirections({
              teams: enrichedTeams,
              transactions,
              picks: current.valueBundle.picks,
              overrides: current.preferences.settings.teamDirectionOverrides,
            }),
            managerProfiles: buildManagerProfiles(transactions, enrichedTeams, current.valueBundle.players, current.valueBundle.picks),
          }
        })
      })
    }
    if ((view === 'journal' || view === 'strategy') && !data.journalLoaded) {
      startOnce('journal', async () => {
        const journal = await fetchJournal(activeLeagueId).catch(() => EMPTY_JOURNAL)
        setData((current) => {
          if (!current || current.leagueBundle.league.league_id !== activeLeagueId) return current
          const transactions = journalTransactionsForCurrentManagers(journal, activeLeagueId)
          const directions = buildTeamDirections({
            teams: current.teams,
            transactions,
            picks: current.valueBundle.picks,
            overrides: current.preferences.settings.teamDirectionOverrides,
          })
          return {
            ...current,
            journal,
            journalLoaded: true,
            directions,
            managerProfiles: buildManagerProfiles(transactions, current.teams, current.valueBundle.players, current.valueBundle.picks),
          }
        })
      })
    }
  }, [data, view])

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
    if (patch.settings && Object.prototype.hasOwnProperty.call(patch.settings, 'teamDirectionOverrides')) {
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

  const selectLeague = (nextLeagueId: SupportedLeagueId) => {
    void loadLeague(nextLeagueId)
  }

  const openTradeDraft = (draft: Omit<TradeDraft, 'nonce'>) => {
    setTradeDraft({ ...draft, nonce: Date.now() })
    setView('trade')
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
        return { ...current, journal, journalLoaded: true, teams, directions, managerProfiles: buildManagerProfiles(transactions, teams, current.valueBundle.players, current.valueBundle.picks) }
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
      />
      {data && <LeagueRibbon data={data} loading={loading} onSelectLeague={selectLeague} />}
      {loading && !data ? (
        <LoadingState />
      ) : error && !data ? (
        <ErrorState message={error} onRetry={() => void loadLeague(leagueId)} loading={loading} />
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
              leagueContext={data.leagueContext}
            />
          ) : (
            <Suspense fallback={<ViewLoading label="Loading this workspace…" />}>
              {view === 'trade' ? (
                <TradeView
                  key={`trade-${data.leagueBundle.league.league_id}-${tradeDraft?.nonce ?? 'manual'}`}
                  teams={data.teams}
                  rosterPositions={data.leagueBundle.league.roster_positions}
                  leagueContext={data.leagueContext}
                  initialDraft={tradeDraft}
                  strategyRosterId={data.preferences.myRosterId ?? data.teams[0].rosterId}
                  strategy={resolveTeamStrategy(
                    data.teams.find((team) => team.rosterId === (data.preferences.myRosterId ?? data.teams[0].rosterId)) ?? data.teams[0],
                    data.preferences.settings.teamStrategy,
                  )}
                  onStrategyChange={(teamStrategy) => updatePreferences({ settings: { teamStrategy } })}
                />
              ) : view === 'journal' ? (
                data.journalLoaded
                  ? <TradeJournalView journal={data.journal} syncing={journalSyncing} onSync={() => void refreshJournal()} leagueContext={data.leagueContext} />
                  : <ViewLoading label="Loading the stored trade journal…" />
              ) : view === 'intel' ? (
                <IntelView key={`intel-${data.leagueBundle.league.league_id}`} teams={data.teams} valueBundle={data.valueBundle} eventHealth={data.eventModelHealth ?? null} preferences={data.preferences} onUpdatePreferences={updatePreferences} />
              ) : view === 'strategy' ? (
                <EdgeView key={`edge-${data.leagueBundle.league.league_id}`} teams={data.teams} profiles={data.managerProfiles} directions={data.directions} myRosterId={data.preferences.myRosterId ?? data.teams[0].rosterId} rosterPositions={data.leagueBundle.league.roster_positions} valueBundle={data.valueBundle} journal={data.journal} preferences={data.preferences} leagueContext={data.leagueContext} onUpdatePreferences={updatePreferences} onOpenTrade={openTradeDraft} journalSyncing={journalSyncing || !data.journalLoaded} onSyncJournal={() => void refreshJournal()} onOpenJournal={() => setView('journal')} />
              ) : view === 'rookies' ? (
                data.rookieBoard === undefined
                  ? <ViewLoading label="Loading rookie evidence…" />
                  : <RookieBoardView bundle={data.rookieBoard} leagueContext={data.leagueContext} />
              ) : (
                data.modelHealth === undefined
                  ? <ViewLoading label="Loading model health…" />
                  : <ModelView health={data.modelHealth} leagueContext={data.leagueContext} />
              )}
            </Suspense>
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
