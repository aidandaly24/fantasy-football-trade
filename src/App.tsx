import { ArrowLeftRight, BarChart3, BookOpen, CircleGauge, GraduationCap, Radar, RefreshCw, Target } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fetchEdgeState, fetchEventModelHealth, fetchIntel, fetchJournal, fetchLeagueBundle, fetchModelHealth, fetchProjections, fetchResearchState, fetchRookieBoard, fetchUserState, fetchValues, saveLeaguePreferences, syncJournal } from './api'
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
import type { EventModelHealthBundle, JournalBundle, LeagueBundle, LeaguePreferences, ModelHealthBundle, PlayerProjection, ProjectionBundle, RankingMode, Team, UserState, ValueBundle } from './types'
import { EdgeView } from './views/EdgeView'
import { IntelView } from './views/IntelView'
import { ModelView } from './views/ModelView'
import { RankingsView } from './views/RankingsView'
import { RookieBoardView } from './views/RookieBoardView'
import { TradeJournalView } from './views/TradeJournalView'
import { TradeView } from './views/TradeView'
import type { TradeDraft } from './views/types'

const DEFAULT_LEAGUE_ID: SupportedLeagueId = SUPPORTED_LEAGUES[0].id
const LAST_LEAGUE_KEY = 'rosterlab:last-league'
const CORE_CACHE_PREFIX = 'rosterlab:core:v1:'
const CORE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

type AppData = {
  leagueBundle: LeagueBundle
  leagueContext: LeagueContext
  valueBundle: ValueBundle
  playerProjections: Map<string, PlayerProjection>
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

type CachedLeagueCore = {
  version: 1
  cachedAt: string
  leagueBundle: LeagueBundle
  valueBundle: ValueBundle
  projectionBundle: ProjectionBundle | null
  preferences: LeaguePreferences
}

type LeagueLoadPrefetch = {
  league?: Promise<LeagueBundle>
  values?: Promise<ValueBundle>
  projections?: Promise<ProjectionBundle | null>
  preferences?: LeaguePreferences
}

type View = 'rankings' | 'trade' | 'journal' | 'intel' | 'strategy' | 'rookies' | 'model'

const EMPTY_JOURNAL: JournalBundle = {
  trades: [],
  identities: [],
  snapshots: [],
  outcomes: [],
  sync: null,
}

function readCachedLeagueCore(id: SupportedLeagueId): CachedLeagueCore | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${CORE_CACHE_PREFIX}${id}`) ?? 'null') as CachedLeagueCore | null
    if (!parsed || parsed.version !== 1 || parsed.leagueBundle?.league?.league_id !== id) return null
    if (!Number.isFinite(Date.parse(parsed.cachedAt)) || Date.now() - Date.parse(parsed.cachedAt) > CORE_CACHE_MAX_AGE_MS) return null
    if (!Array.isArray(parsed.valueBundle?.players) || !Array.isArray(parsed.valueBundle?.picks)) return null
    if (parsed.preferences?.leagueId !== id || !parsed.preferences.settings) return null
    return parsed
  } catch {
    return null
  }
}

function writeCachedLeagueCore(id: SupportedLeagueId, value: Omit<CachedLeagueCore, 'version' | 'cachedAt'>): void {
  try {
    window.localStorage.setItem(`${CORE_CACHE_PREFIX}${id}`, JSON.stringify({ version: 1, cachedAt: new Date().toISOString(), ...value }))
  } catch {
    // The live refresh remains authoritative when device storage is unavailable or full.
  }
}

function writeCachedLeaguePreferences(preferences: LeaguePreferences): void {
  if (!isSupportedLeagueId(preferences.leagueId)) return
  const cached = readCachedLeagueCore(preferences.leagueId)
  if (!cached) return
  writeCachedLeagueCore(preferences.leagueId, {
    leagueBundle: cached.leagueBundle,
    valueBundle: cached.valueBundle,
    projectionBundle: cached.projectionBundle,
    preferences,
  })
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

function DeferredWorkspace({ view }: { view: 'journal' | 'rookies' | 'model' }) {
  const content = view === 'journal'
    ? {
        pageClass: 'journal-page',
        heroClass: 'journal-hero',
        eyebrow: 'Automated trade journal',
        title: 'Every completed deal. No selective memory.',
        description: 'The journal workspace is ready. Loading the latest saved league ledger now.',
        status: 'Loading saved trades…',
      }
    : view === 'rookies'
      ? {
          pageClass: 'rookie-page',
          heroClass: 'rookie-hero panel',
          eyebrow: 'Private rookie research',
          title: 'Production evidence, not a trade promise.',
          description: 'The rookie workspace is ready. Loading the validated evidence artifact now.',
          status: 'Loading rookie evidence…',
        }
      : {
          pageClass: 'model-page',
          heroClass: 'model-hero panel',
          eyebrow: 'Model audit',
          title: 'Trust is earned one gate at a time.',
          description: 'The model workspace is ready. Loading the latest promotion and calibration results now.',
          status: 'Loading model health…',
        }
  return (
    <main className={`page-shell ${content.pageClass}`}>
      <section className={content.heroClass}>
        <div>
          <span className="eyebrow accent-eyebrow">{content.eyebrow}</span>
          <h1>{content.title}</h1>
          <p>{content.description}</p>
        </div>
        <div className="deferred-view-status">
          <RefreshCw className="spin" size={18} />
          <span><strong>{content.status}</strong><small>The rest of the screen is already interactive.</small></span>
        </div>
      </section>
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

  const showCachedLeague = (cached: CachedLeagueCore) => {
    const context = leagueContext(cached.leagueBundle)
    const playerProjections = new Map(cached.projectionBundle?.stale ? [] : Object.entries(cached.projectionBundle?.projections ?? {})
      .map(([playerId, projection]) => [playerId, projectionForLeague(projection, context)] as const))
    const teams = buildTeams(cached.leagueBundle, cached.valueBundle, new Map(), playerProjections)
    const transactions = journalTransactionsForCurrentManagers(EMPTY_JOURNAL, cached.leagueBundle.league.league_id)
    setData({
      leagueBundle: cached.leagueBundle,
      leagueContext: context,
      valueBundle: cached.valueBundle,
      playerProjections,
      teams,
      modelHealth: undefined,
      eventModelHealth: undefined,
      rookieBoard: undefined,
      managerProfiles: buildManagerProfiles(transactions, teams, cached.valueBundle.players, cached.valueBundle.picks),
      directions: buildTeamDirections({
        teams,
        transactions,
        picks: cached.valueBundle.picks,
        overrides: cached.preferences.settings.teamDirectionOverrides,
      }),
      journal: EMPTY_JOURNAL,
      journalLoaded: false,
      preferences: cached.preferences,
    })
    setMode(cached.preferences.settings.rankingMode ?? 'overall')
    setLeagueId(context.id)
    setSelectedId(teams[0]?.rosterId ?? 1)
    setTradeDraft(null)
  }

  const loadLeague = async (
    id: SupportedLeagueId,
    stateOverride: UserState | null = userState,
    prefetch: LeagueLoadPrefetch = {},
  ) => {
    setLoading(true)
    setError(null)
    ;['rookies', 'model', 'event-model', 'journal'].forEach((kind) => secondaryLoads.current.delete(`${id}:${kind}`))
    try {
      const preset = SUPPORTED_LEAGUES.find((item) => item.id === id)!
      const leagueRequest = prefetch.league ?? fetchLeagueBundle(id)
      const valueRequest = prefetch.values ?? fetchValues(preset.marketFormat)
      const projectionRequest = prefetch.projections ?? fetchProjections()
      const leagueBundle = await leagueRequest
      const context = leagueContext(leagueBundle)
      const existingPreference = stateOverride?.preferences.find((item) => item.leagueId === id) ?? prefetch.preferences
      const presetMatches = context.marketFormat.numQbs === preset.marketFormat.numQbs
        && context.marketFormat.tep === preset.marketFormat.tep
        && context.marketFormat.numTeams === preset.marketFormat.numTeams
      const [valueBundle, projectionBundle] = await Promise.all([
        presetMatches ? valueRequest : fetchValues(context.marketFormat),
        projectionRequest,
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
      writeCachedLeagueCore(id, { leagueBundle, valueBundle, projectionBundle, preferences: basePreference })

      if (stateOverride) {
        void saveLeaguePreferences(basePreference).then((saved) => {
          setData((current) => current?.leagueBundle.league.league_id === id
            ? { ...current, preferences: saved.preferences }
            : current)
          setUserState((current) => ({
            user: saved.user,
            preferences: [saved.preferences, ...(current?.preferences ?? []).filter((item) => item.leagueId !== id)],
          }))
        }).catch(() => undefined)
      }

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
      const initialLeague = localLeague ?? DEFAULT_LEAGUE_ID
      const cached = readCachedLeagueCore(initialLeague)
      if (cached) showCachedLeague(cached)
      const preset = SUPPORTED_LEAGUES.find((item) => item.id === initialLeague)!
      const statePromise = fetchUserState()
      const leaguePromise = fetchLeagueBundle(initialLeague)
      const valuePromise = fetchValues(preset.marketFormat)
      const projectionPromise = fetchProjections()
      const state = await statePromise
      setUserState(state)
      const savedLeagueId = state?.preferences.find((item) => isSupportedLeagueId(item.leagueId))?.leagueId
      const savedLeague = localLeague ?? (isSupportedLeagueId(savedLeagueId) ? savedLeagueId : initialLeague)
      await loadLeague(savedLeague, state, savedLeague === initialLeague
        ? { league: leaguePromise, values: valuePromise, projections: projectionPromise, preferences: cached?.preferences }
        : {})
    })()
  }, [])

  useEffect(() => {
    if (!data) return
    const activeLeagueId = data.leagueBundle.league.league_id
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      void fetchJournal(activeLeagueId).then((journal) => {
        setData((current) => {
          if (!current || current.leagueBundle.league.league_id !== activeLeagueId) return current
          const transactions = journalTransactionsForCurrentManagers(journal, activeLeagueId)
          return {
            ...current,
            journal,
            journalLoaded: true,
            directions: buildTeamDirections({
              teams: current.teams,
              transactions,
              picks: current.valueBundle.picks,
              overrides: current.preferences.settings.teamDirectionOverrides,
            }),
            managerProfiles: buildManagerProfiles(transactions, current.teams, current.valueBundle.players, current.valueBundle.picks),
          }
        })
      }).catch(() => undefined)
      void fetchRookieBoard().then((rookieBoard) => {
        setData((current) => current?.leagueBundle.league.league_id === activeLeagueId ? { ...current, rookieBoard } : current)
      }).catch(() => undefined)
      void fetchModelHealth().then((modelHealth) => {
        setData((current) => current?.leagueBundle.league.league_id === activeLeagueId ? { ...current, modelHealth } : current)
      })
      void fetchEventModelHealth().then((eventModelHealth) => {
        setData((current) => current?.leagueBundle.league.league_id === activeLeagueId ? { ...current, eventModelHealth } : current)
      })
      void fetchIntel().catch(() => undefined)
      void fetchEdgeState(activeLeagueId).catch(() => undefined)
      void fetchResearchState(activeLeagueId, false).catch(() => undefined)
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [data?.leagueBundle.league.league_id])

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
    writeCachedLeaguePreferences(next)
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
    const cached = readCachedLeagueCore(nextLeagueId)
    if (cached) showCachedLeague(cached)
    void loadLeague(nextLeagueId, userState, { preferences: cached?.preferences })
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
            <>
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
                  : <DeferredWorkspace view="journal" />
              ) : view === 'intel' ? (
                <IntelView key={`intel-${data.leagueBundle.league.league_id}`} teams={data.teams} valueBundle={data.valueBundle} eventHealth={data.eventModelHealth ?? null} preferences={data.preferences} onUpdatePreferences={updatePreferences} />
              ) : view === 'strategy' ? (
                <EdgeView key={`edge-${data.leagueBundle.league.league_id}`} teams={data.teams} profiles={data.managerProfiles} directions={data.directions} myRosterId={data.preferences.myRosterId ?? data.teams[0].rosterId} rosterPositions={data.leagueBundle.league.roster_positions} valueBundle={data.valueBundle} journal={data.journal} preferences={data.preferences} leagueContext={data.leagueContext} onUpdatePreferences={updatePreferences} onOpenTrade={openTradeDraft} journalSyncing={journalSyncing || !data.journalLoaded} onSyncJournal={() => void refreshJournal()} onOpenJournal={() => setView('journal')} />
              ) : view === 'rookies' ? (
                data.rookieBoard === undefined
                  ? <DeferredWorkspace view="rookies" />
                  : <RookieBoardView bundle={data.rookieBoard} leagueContext={data.leagueContext} />
              ) : (
                data.modelHealth === undefined
                  ? <DeferredWorkspace view="model" />
                  : <ModelView health={data.modelHealth} leagueContext={data.leagueContext} />
              )}
            </>
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
