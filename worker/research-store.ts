import {
  auditHistoricalTrainingExamples,
  buildHistoricalTrainingExamples,
  buildResearchPipeline,
  evaluateHistoricalReturnShadow,
  evaluateNewsFeatureLift,
  reconstructLeagueWeekStates,
  type HistoricalMarketPoint,
  type HistoricalNewsObservation,
  type MatchupObservation,
  type ObjectivePlayerObservation,
  type ResearchPipelineBundle,
} from '../src/research'
import type { EventModelHealthBundle } from '../src/types'
import type { D1Database, D1PreparedStatement } from './user-store'

const SLEEPER_BASE = 'https://api.sleeper.app/v1'
const DAY_MS = 86_400_000
const OBJECTIVE_BATCH = 40

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS league_week_states (
    root_league_id TEXT NOT NULL, league_id TEXT NOT NULL, season TEXT NOT NULL,
    week INTEGER NOT NULL, roster_id INTEGER NOT NULL, owner_user_id TEXT,
    players_json TEXT NOT NULL, starters_json TEXT NOT NULL,
    points REAL NOT NULL, points_against REAL NOT NULL,
    wins INTEGER NOT NULL, losses INTEGER NOT NULL, ties INTEGER NOT NULL,
    source_version TEXT NOT NULL, captured_at TEXT NOT NULL,
    PRIMARY KEY (league_id, week, roster_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_league_week_states_root
    ON league_week_states (root_league_id, season, week, roster_id)`,
  `CREATE TABLE IF NOT EXISTS objective_player_observations (
    asset_id TEXT NOT NULL, observed_date TEXT NOT NULL, observed_at TEXT NOT NULL,
    name TEXT NOT NULL, position TEXT, team TEXT, age REAL, active INTEGER,
    status TEXT, injury_status TEXT, depth_chart_order INTEGER, depth_chart_position TEXT,
    source TEXT NOT NULL, source_version TEXT NOT NULL,
    PRIMARY KEY (asset_id, observed_date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_objective_player_observations_date
    ON objective_player_observations (asset_id, observed_at)`,
  `CREATE TABLE IF NOT EXISTS manager_behavior_snapshots (
    root_league_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, as_of_date TEXT NOT NULL,
    trade_count INTEGER NOT NULL, initiated_count INTEGER NOT NULL,
    received_players INTEGER NOT NULL, received_picks INTEGER NOT NULL,
    sent_players INTEGER NOT NULL, sent_picks INTEGER NOT NULL,
    pick_affinity REAL NOT NULL, consolidation_index REAL NOT NULL,
    sample_weight REAL NOT NULL, evidence_json TEXT NOT NULL,
    PRIMARY KEY (root_league_id, owner_user_id, as_of_date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_manager_behavior_root
    ON manager_behavior_snapshots (root_league_id, as_of_date)`,
  `CREATE TABLE IF NOT EXISTS research_pipeline_runs (
    id TEXT PRIMARY KEY, root_league_id TEXT NOT NULL, started_at TEXT NOT NULL,
    finished_at TEXT, status TEXT NOT NULL, seasons INTEGER NOT NULL DEFAULT 0,
    expected_roster_weeks INTEGER NOT NULL DEFAULT 0, roster_weeks INTEGER NOT NULL DEFAULT 0,
    identity_parties INTEGER NOT NULL DEFAULT 0, mapped_identity_parties INTEGER NOT NULL DEFAULT 0,
    errors_json TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_research_pipeline_runs_root
    ON research_pipeline_runs (root_league_id, started_at)`,
  'PRAGMA optimize',
] as const

let schemaReady: Promise<void> | null = null

export async function ensureResearchSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = db.batch(SCHEMA.map((sql) => db.prepare(sql))).then(() => undefined).catch((error) => {
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { 'User-Agent': 'RosterLab/5.6 private historical research' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json<T>()
}

async function batchInChunks(db: D1Database, statements: D1PreparedStatement[], size = 60): Promise<void> {
  for (let index = 0; index < statements.length; index += size) await db.batch(statements.slice(index, index + size))
}

type SeasonRow = { league_id: string; season: string; total_rosters: number }
type IdentityRow = { league_id: string; roster_id: number; owner_user_id: string | null }
type SleeperMatchup = {
  roster_id: number
  matchup_id: number | null
  players: string[] | null
  starters: string[] | null
  points: number | null
  custom_points?: number | null
}

async function snapshotManagerBehavior(db: D1Database, rootLeagueId: string, now: Date): Promise<{
  managers: number
  reliableManagers: number
  identityParties: number
  mappedIdentityParties: number
}> {
  const [identities, tradeRows] = await Promise.all([
    db.prepare(`SELECT sr.league_id, sr.roster_id, sr.owner_user_id
FROM season_rosters sr JOIN league_seasons ls ON ls.league_id=sr.league_id
WHERE ls.root_league_id=?`).bind(rootLeagueId).all<IdentityRow>(),
    db.prepare(`SELECT league_id, creator_user_id, raw_json FROM trades
WHERE root_league_id=? ORDER BY created_at_ms`).bind(rootLeagueId).all<{
      league_id: string; creator_user_id: string | null; raw_json: string
    }>(),
  ])
  const ownerByRoster = new Map(identities.results.map((row) => [`${row.league_id}:${row.roster_id}`, row.owner_user_id]))
  type Accumulator = {
    tradeIds: Set<string>; initiated: number; receivedPlayers: number; receivedPicks: number
    sentPlayers: number; sentPicks: number
  }
  const managers = new Map<string, Accumulator>()
  let identityParties = 0
  let mappedIdentityParties = 0
  const accumulator = (ownerId: string): Accumulator => {
    const current = managers.get(ownerId) ?? {
      tradeIds: new Set(), initiated: 0, receivedPlayers: 0, receivedPicks: 0, sentPlayers: 0, sentPicks: 0,
    }
    managers.set(ownerId, current)
    return current
  }
  tradeRows.results.forEach((row) => {
    let trade: {
      transaction_id?: string; roster_ids?: number[]; adds?: Record<string, number> | null
      drops?: Record<string, number> | null
      draft_picks?: Array<{ owner_id: number; previous_owner_id: number }>
    }
    try { trade = JSON.parse(row.raw_json) as typeof trade } catch { return }
    const transactionId = trade.transaction_id ?? `${row.league_id}:${managers.size}`
    ;(trade.roster_ids ?? []).forEach((rosterId) => {
      identityParties += 1
      const ownerId = ownerByRoster.get(`${row.league_id}:${rosterId}`)
      if (!ownerId) return
      mappedIdentityParties += 1
      const current = accumulator(ownerId)
      current.tradeIds.add(transactionId)
      if (row.creator_user_id === ownerId) current.initiated += 1
    })
    Object.values(trade.adds ?? {}).forEach((rosterId) => {
      const ownerId = ownerByRoster.get(`${row.league_id}:${rosterId}`)
      if (ownerId) accumulator(ownerId).receivedPlayers += 1
    })
    Object.values(trade.drops ?? {}).forEach((rosterId) => {
      const ownerId = ownerByRoster.get(`${row.league_id}:${rosterId}`)
      if (ownerId) accumulator(ownerId).sentPlayers += 1
    })
    ;(trade.draft_picks ?? []).forEach((pick) => {
      const receiving = ownerByRoster.get(`${row.league_id}:${pick.owner_id}`)
      const sending = ownerByRoster.get(`${row.league_id}:${pick.previous_owner_id}`)
      if (receiving) accumulator(receiving).receivedPicks += 1
      if (sending) accumulator(sending).sentPicks += 1
    })
  })
  const asOfDate = now.toISOString().slice(0, 10)
  const statements = [...managers.entries()].map(([ownerId, value]) => {
    const tradeCount = value.tradeIds.size
    const received = value.receivedPlayers + value.receivedPicks
    const sent = value.sentPlayers + value.sentPicks
    const pickAffinity = (value.receivedPicks + 2) / (received + 4)
    const consolidationRaw = tradeCount ? (sent - received) / tradeCount : 0
    const sampleWeight = tradeCount / (tradeCount + 12)
    const consolidationIndex = 0.5 + Math.max(-0.5, Math.min(0.5, consolidationRaw / 4)) * sampleWeight
    return db.prepare(`INSERT INTO manager_behavior_snapshots (
  root_league_id, owner_user_id, as_of_date, trade_count, initiated_count,
  received_players, received_picks, sent_players, sent_picks,
  pick_affinity, consolidation_index, sample_weight, evidence_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(root_league_id, owner_user_id, as_of_date) DO UPDATE SET
  trade_count=excluded.trade_count, initiated_count=excluded.initiated_count,
  received_players=excluded.received_players, received_picks=excluded.received_picks,
  sent_players=excluded.sent_players, sent_picks=excluded.sent_picks,
  pick_affinity=excluded.pick_affinity, consolidation_index=excluded.consolidation_index,
  sample_weight=excluded.sample_weight, evidence_json=excluded.evidence_json`).bind(
      rootLeagueId, ownerId, asOfDate, tradeCount, value.initiated,
      value.receivedPlayers, value.receivedPicks, value.sentPlayers, value.sentPicks,
      pickAffinity, consolidationIndex, sampleWeight,
      JSON.stringify({ prior: 'league-neutral', shrinkageTrades: 12, completedTradesOnly: true }),
    )
  })
  if (statements.length) await batchInChunks(db, statements)
  return {
    managers: managers.size,
    reliableManagers: [...managers.values()].filter((item) => item.tradeIds.size >= 8).length,
    identityParties,
    mappedIdentityParties,
  }
}

export async function syncLeagueResearch(db: D1Database, rootLeagueId: string, now = new Date()): Promise<void> {
  await ensureResearchSchema(db)
  const startedAt = now.toISOString()
  const runId = `${rootLeagueId}:${startedAt}`
  await db.prepare(`INSERT INTO research_pipeline_runs (id, root_league_id, started_at, status)
VALUES (?, ?, ?, 'running')`).bind(runId, rootLeagueId, startedAt).run()
  const errors: Array<{ leagueId: string; week: number; error: string }> = []
  try {
    const [seasonsResult, identitiesResult] = await Promise.all([
      db.prepare(`SELECT league_id, season, total_rosters FROM league_seasons
WHERE root_league_id=? ORDER BY season`).bind(rootLeagueId).all<SeasonRow>(),
      db.prepare(`SELECT sr.league_id, sr.roster_id, sr.owner_user_id
FROM season_rosters sr JOIN league_seasons ls ON ls.league_id=sr.league_id
WHERE ls.root_league_id=?`).bind(rootLeagueId).all<IdentityRow>(),
    ])
    const identityBySeason = new Map<string, Map<number, string | null>>()
    identitiesResult.results.forEach((row) => {
      const map = identityBySeason.get(row.league_id) ?? new Map<number, string | null>()
      map.set(row.roster_id, row.owner_user_id)
      identityBySeason.set(row.league_id, map)
    })
    const states = [] as ReturnType<typeof reconstructLeagueWeekStates>
    let expectedRosterWeeks = 0
    for (const season of seasonsResult.results) {
      const weeks = await Promise.all(Array.from({ length: 18 }, (_, index) => index + 1).map(async (week) => {
        try {
          const matchups = await requestJson<SleeperMatchup[]>(`${SLEEPER_BASE}/league/${season.league_id}/matchups/${week}`)
          return {
            week,
            matchups: matchups.map((row): MatchupObservation => ({
              rosterId: row.roster_id,
              matchupId: row.matchup_id,
              players: row.players ?? [],
              starters: row.starters ?? [],
              points: Number(row.custom_points ?? row.points ?? 0),
            })),
          }
        } catch (error) {
          errors.push({ leagueId: season.league_id, week, error: error instanceof Error ? error.message : String(error) })
          return { week, matchups: [] as MatchupObservation[] }
        }
      }))
      const highestObservedWeek = Math.max(0, ...weeks.filter((item) => item.matchups.length).map((item) => item.week))
      expectedRosterWeeks += highestObservedWeek * season.total_rosters
      states.push(...reconstructLeagueWeekStates({
        leagueId: season.league_id,
        season: season.season,
        ownerByRoster: identityBySeason.get(season.league_id) ?? new Map(),
        weeks,
      }))
    }
    if (states.length) {
      await batchInChunks(db, states.map((state) => db.prepare(`INSERT INTO league_week_states (
  root_league_id, league_id, season, week, roster_id, owner_user_id,
  players_json, starters_json, points, points_against, wins, losses, ties,
  source_version, captured_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sleeper-matchups-v1', ?)
ON CONFLICT(league_id, week, roster_id) DO UPDATE SET
  owner_user_id=excluded.owner_user_id, players_json=excluded.players_json,
  starters_json=excluded.starters_json, points=excluded.points,
  points_against=excluded.points_against, wins=excluded.wins,
  losses=excluded.losses, ties=excluded.ties, captured_at=excluded.captured_at`).bind(
        rootLeagueId, state.leagueId, state.season, state.week, state.rosterId, state.ownerUserId,
        JSON.stringify(state.players), JSON.stringify(state.starters), state.points, state.pointsAgainst,
        state.wins, state.losses, state.ties, startedAt,
      )))
    }
    const manager = await snapshotManagerBehavior(db, rootLeagueId, now)
    await db.prepare(`UPDATE research_pipeline_runs SET finished_at=?, status=?, seasons=?,
expected_roster_weeks=?, roster_weeks=?, identity_parties=?, mapped_identity_parties=?, errors_json=?
WHERE id=?`).bind(
      new Date().toISOString(), errors.length ? 'partial' : 'complete', seasonsResult.results.length,
      expectedRosterWeeks, states.length, manager.identityParties, manager.mappedIdentityParties,
      JSON.stringify(errors), runId,
    ).run()
  } catch (error) {
    await db.prepare(`UPDATE research_pipeline_runs SET finished_at=?, status='failed', errors_json=? WHERE id=?`).bind(
      new Date().toISOString(), JSON.stringify([{ error: error instanceof Error ? error.message : String(error) }]), runId,
    ).run()
    throw error
  }
}

type DuePlayerRow = { asset_id: string; asset_name: string; last_observed_at: string | null }
type SleeperPlayer = {
  player_id?: string; full_name?: string | null; first_name?: string | null; last_name?: string | null
  position?: string | null; team?: string | null; age?: number | null; active?: boolean | null
  status?: string | null; injury_status?: string | null; depth_chart_order?: number | null
  depth_chart_position?: string | null; news_updated?: number | null
}

export async function captureDueObjectivePlayers(db: D1Database, now = new Date()): Promise<void> {
  await ensureResearchSchema(db)
  const due = await db.prepare(`SELECT latest.asset_id, latest.asset_name, MAX(o.observed_at) AS last_observed_at
FROM (
  SELECT asset_id, MAX(asset_name) AS asset_name FROM market_value_snapshots
  WHERE kind='player' GROUP BY asset_id
) latest LEFT JOIN objective_player_observations o ON o.asset_id=latest.asset_id
GROUP BY latest.asset_id, latest.asset_name
HAVING last_observed_at IS NULL OR last_observed_at < ?
ORDER BY COALESCE(last_observed_at, '') ASC, latest.asset_id LIMIT ?`).bind(
    new Date(now.getTime() - DAY_MS).toISOString(), OBJECTIVE_BATCH,
  ).all<DuePlayerRow>()
  const results = await Promise.all(due.results.map(async (row) => {
    try {
      const player = await requestJson<SleeperPlayer>(`${SLEEPER_BASE}/players/nfl/${encodeURIComponent(row.asset_id)}`)
      return { row, player }
    } catch {
      return null
    }
  }))
  const observedAt = now.toISOString()
  const statements = results.flatMap((result) => {
    if (!result) return []
    const { row, player } = result
    const name = player.full_name ?? `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim() ?? row.asset_name
    return [db.prepare(`INSERT INTO objective_player_observations (
  asset_id, observed_date, observed_at, name, position, team, age, active,
  status, injury_status, depth_chart_order, depth_chart_position, source, source_version
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sleeper-player', ?)
ON CONFLICT(asset_id, observed_date) DO UPDATE SET
  observed_at=excluded.observed_at, name=excluded.name, position=excluded.position,
  team=excluded.team, age=excluded.age, active=excluded.active, status=excluded.status,
  injury_status=excluded.injury_status, depth_chart_order=excluded.depth_chart_order,
  depth_chart_position=excluded.depth_chart_position, source_version=excluded.source_version`).bind(
      row.asset_id, observedAt.slice(0, 10), observedAt, name || row.asset_name,
      player.position ?? null, player.team ?? null, player.age ?? null,
      player.active === null || player.active === undefined ? null : player.active ? 1 : 0,
      player.status ?? null, player.injury_status ?? null, player.depth_chart_order ?? null,
      player.depth_chart_position ?? null, String(player.news_updated ?? observedAt),
    )]
  })
  if (statements.length) await batchInChunks(db, statements)
}

type HistoricalRow = {
  asset_id: string; asset_name: string; position: string; observed_at: string; provider_value: number
}
type ObjectiveRow = {
  asset_id: string; observed_at: string; team: string | null; active: number | null
  status: string | null; injury_status: string | null; depth_chart_order: number | null
}
type NewsRow = {
  player_id: string; published_at: string; event_type: string; direction: 'up' | 'down' | 'watch'
  impact_weight: number; sources_json: string
}
type RunRow = {
  started_at: string; finished_at: string | null; seasons: number; expected_roster_weeks: number
  roster_weeks: number; identity_parties: number; mapped_identity_parties: number
}
type CountRow = { count: number }
type ManagerSummaryRow = { managers: number; reliable_managers: number }
type ObjectiveSummaryRow = { observations: number; players: number; last_observed_at: string | null }

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

export async function readResearchPipeline(
  db: D1Database,
  userId: string,
  leagueId: string,
  eventHealth: (EventModelHealthBundle & { trainingRows?: number; validationRows?: number; testRows?: number }) | null,
): Promise<ResearchPipelineBundle> {
  await ensureResearchSchema(db)
  const [run, historicalRows, objectiveRows, newsRows, objectiveSummary, managers, trades] = await Promise.all([
    db.prepare(`SELECT started_at, finished_at, seasons, expected_roster_weeks, roster_weeks,
identity_parties, mapped_identity_parties FROM research_pipeline_runs
WHERE root_league_id=? ORDER BY started_at DESC LIMIT 1`).bind(leagueId).first<RunRow>(),
    db.prepare(`SELECT h.asset_id, h.asset_name, h.position, h.observed_at, h.provider_value
FROM historical_market_observations h JOIN historical_tape_assets a
  ON a.provider=h.provider AND a.asset_id=h.asset_id
WHERE a.user_id=? AND a.league_id=? AND a.status='complete'
ORDER BY h.asset_id, h.observed_at LIMIT 20000`).bind(userId, leagueId).all<HistoricalRow>(),
    db.prepare(`SELECT o.asset_id, o.observed_at, o.team, o.active, o.status,
o.injury_status, o.depth_chart_order FROM objective_player_observations o
JOIN historical_tape_assets a ON a.asset_id=o.asset_id
WHERE a.user_id=? AND a.league_id=? AND a.status='complete'
ORDER BY o.asset_id, o.observed_at LIMIT 20000`).bind(userId, leagueId).all<ObjectiveRow>(),
    db.prepare(`SELECT DISTINCT e.player_id, e.published_at, e.event_type, e.direction,
e.impact_weight, e.sources_json FROM intel_events e
JOIN historical_tape_assets a ON a.asset_id=e.player_id
WHERE a.user_id=? AND a.league_id=? AND a.status='complete'
ORDER BY e.published_at LIMIT 10000`).bind(userId, leagueId).all<NewsRow>(),
    db.prepare(`SELECT COUNT(*) AS observations, COUNT(DISTINCT asset_id) AS players,
MAX(observed_at) AS last_observed_at FROM objective_player_observations`).first<ObjectiveSummaryRow>(),
    db.prepare(`SELECT COUNT(*) AS managers,
SUM(CASE WHEN sample_weight >= 0.4 THEN 1 ELSE 0 END) AS reliable_managers
FROM manager_behavior_snapshots WHERE root_league_id=? AND as_of_date=(
  SELECT MAX(as_of_date) FROM manager_behavior_snapshots WHERE root_league_id=?
)`).bind(leagueId, leagueId).first<ManagerSummaryRow>(),
    db.prepare(`SELECT COUNT(*) AS count FROM trades WHERE root_league_id=?`).bind(leagueId).first<CountRow>(),
  ])
  const market: HistoricalMarketPoint[] = historicalRows.results.map((row) => ({
    assetId: row.asset_id, assetName: row.asset_name, position: row.position,
    observedAt: row.observed_at, value: Number(row.provider_value),
  }))
  const objective: ObjectivePlayerObservation[] = objectiveRows.results.map((row) => ({
    assetId: row.asset_id, observedAt: row.observed_at, team: row.team,
    active: row.active === null ? null : Boolean(row.active), status: row.status,
    injuryStatus: row.injury_status, depthChartOrder: row.depth_chart_order,
  }))
  const news: HistoricalNewsObservation[] = newsRows.results.map((row) => ({
    playerId: row.player_id, publishedAt: row.published_at, eventType: row.event_type,
    direction: row.direction, impactWeight: row.impact_weight,
  }))
  const examples = buildHistoricalTrainingExamples(market, objective, news)
  const training = auditHistoricalTrainingExamples(examples)
  const shadow = evaluateHistoricalReturnShadow(examples)
  const newsEvaluation = evaluateNewsFeatureLift(examples)
  const newsSources = new Set(newsRows.results.flatMap((row) =>
    parseJson<Array<{ name?: string }>>(row.sources_json, []).map((source) => source.name).filter(Boolean),
  ))
  const objectiveSeasons = eventHealth
    ? new Set([eventHealth.trainingSeason, eventHealth.validationSeason, eventHealth.testSeason]).size
    : 0
  const objectiveHistoricalRows = eventHealth
    ? Number(eventHealth.trainingRows ?? 0) + Number(eventHealth.validationRows ?? 0) + Number(eventHealth.testRows ?? eventHealth.eventTestRows ?? 0)
    : 0
  return buildResearchPipeline({
    generatedAt: new Date().toISOString(),
    leagueId,
    lastLeagueSyncAt: run?.finished_at ?? run?.started_at ?? null,
    seasons: Number(run?.seasons ?? 0),
    expectedRosterWeeks: Number(run?.expected_roster_weeks ?? 0),
    rosterWeeks: Number(run?.roster_weeks ?? 0),
    objectiveSourceSeasons: objectiveSeasons,
    objectiveHistoricalRows,
    objectiveTrackedPlayers: Number(objectiveSummary?.players ?? 0),
    objectiveObservations: Number(objectiveSummary?.observations ?? 0),
    objectiveLastObservedAt: objectiveSummary?.last_observed_at ?? null,
    training,
    shadow: {
      trainingRows: shadow.trainingRows,
      validationRows: shadow.validationRows,
      maeLift: shadow.maeLift,
      productionEnabled: false,
    },
    managers: Number(managers?.managers ?? 0),
    completedTrades: Number(trades?.count ?? 0),
    reliableManagers: Number(managers?.reliable_managers ?? 0),
    identityCoverage: run?.identity_parties ? run.mapped_identity_parties / run.identity_parties : 0,
    storedNewsEvents: newsRows.results.length,
    matchedNewsExamples: examples.filter((row) => row.newsCount7 > 0).length,
    newsSourceCount: newsSources.size,
    newsHeldOutLift: newsEvaluation.maeLift,
  })
}

export async function refreshDueResearch(db: D1Database, now = new Date()): Promise<void> {
  await ensureResearchSchema(db)
  const root = await db.prepare(`SELECT lr.root_league_id FROM league_roots lr
LEFT JOIN research_pipeline_runs rr ON rr.id=(
  SELECT id FROM research_pipeline_runs WHERE root_league_id=lr.root_league_id ORDER BY started_at DESC LIMIT 1
)
WHERE rr.finished_at IS NULL OR rr.finished_at < ?
ORDER BY COALESCE(rr.finished_at, '') ASC LIMIT 1`).bind(
    new Date(now.getTime() - DAY_MS).toISOString(),
  ).first<{ root_league_id: string }>()
  if (root?.root_league_id) await syncLeagueResearch(db, root.root_league_id, now)
  await captureDueObjectivePlayers(db, now)
}
