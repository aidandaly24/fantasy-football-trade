export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>
}

export type AuthenticatedUser = {
  id: string
  email: string
  name: string
}

export type StoredLeaguePreference = {
  leagueId: string
  leagueName: string
  myRosterId: number | null
  watchlist: string[]
  settings: {
    rankingMode?: 'overall' | 'contender' | 'future'
    strategyRosterId?: number
    edgeFilter?: 'all' | 'value' | 'flip' | 'points' | 'intel'
    teamDirectionOverrides?: Record<string, 'contender' | 'retooling' | 'rebuilding'>
    teamStrategy?: {
      mode: 'auto' | 'contender' | 'retooling' | 'rebuilding'
      horizonYears: 1 | 2 | 3 | 4
      flipPriority: number
    }
    tradeModelWeights?: {
      market: number
      lineup: number
      exchange: number
      outcome: number
      outcomeHorizon: 90 | 180 | 365
      outcomeVariant: 'structureOnly' | 'premiumAware'
    }
  }
  updatedAt: string
}

type PreferenceRow = {
  league_id: string
  league_name: string
  my_roster_id: number | null
  watchlist_json: string
  settings_json: string
  updated_at: string
}

const CREATE_PREFERENCES = `CREATE TABLE IF NOT EXISTS user_league_preferences (
  user_id TEXT NOT NULL,
  league_id TEXT NOT NULL,
  league_name TEXT NOT NULL,
  my_roster_id INTEGER,
  watchlist_json TEXT NOT NULL DEFAULT '[]',
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, league_id)
)`
const CREATE_RECENT_INDEX = `CREATE INDEX IF NOT EXISTS idx_user_league_preferences_recent
ON user_league_preferences (user_id, updated_at)`

let schemaReady: Promise<void> | null = null

function safeDecodeName(request: Request, email: string): string {
  const encoded = request.headers.get('oai-authenticated-user-full-name')
  if (!encoded || request.headers.get('oai-authenticated-user-full-name-encoding') !== 'percent-encoded-utf-8') {
    return email
  }
  try {
    return decodeURIComponent(encoded)
  } catch {
    return email
  }
}

export function authenticatedUser(request: Request): AuthenticatedUser | null {
  const id = request.headers.get('oai-authenticated-user-id')?.trim()
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase()
  if (email) return { id: id || `email:${email}`, email, name: safeDecodeName(request, email) }
  const hostname = new URL(request.url).hostname
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return { id: 'local-development', email: 'local@rosterlab.test', name: 'Local development' }
  }
  return null
}

export async function ensureUserSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare(CREATE_PREFERENCES),
      db.prepare(CREATE_RECENT_INDEX),
    ]).then(() => undefined).catch((error) => {
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function preferenceFromRow(row: PreferenceRow): StoredLeaguePreference {
  return {
    leagueId: row.league_id,
    leagueName: row.league_name,
    myRosterId: row.my_roster_id,
    watchlist: parseJson<string[]>(row.watchlist_json, []),
    settings: parseJson<StoredLeaguePreference['settings']>(row.settings_json, {}),
    updatedAt: row.updated_at,
  }
}

export function normalizePreferenceInput(input: unknown): Omit<StoredLeaguePreference, 'updatedAt'> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid preferences')
  const value = input as Record<string, unknown>
  const leagueId = typeof value.leagueId === 'string' ? value.leagueId.trim() : ''
  const leagueName = typeof value.leagueName === 'string' ? value.leagueName.trim() : ''
  if (!/^\d{8,24}$/.test(leagueId)) throw new Error('Invalid league ID')
  if (!leagueName || leagueName.length > 120) throw new Error('Invalid league name')
  const myRosterId = value.myRosterId == null ? null : Number(value.myRosterId)
  if (myRosterId !== null && (!Number.isInteger(myRosterId) || myRosterId < 1 || myRosterId > 100)) {
    throw new Error('Invalid roster ID')
  }
  const rawWatchlist = Array.isArray(value.watchlist) ? value.watchlist : []
  const watchlist = [...new Set(rawWatchlist
    .filter((item): item is string => typeof item === 'string' && /^[\w-]{1,64}$/.test(item))
    .slice(0, 50))]
  const rawSettings = value.settings && typeof value.settings === 'object' && !Array.isArray(value.settings)
    ? value.settings as Record<string, unknown>
    : {}
  const settings: StoredLeaguePreference['settings'] = {}
  if (['overall', 'contender', 'future'].includes(String(rawSettings.rankingMode))) {
    settings.rankingMode = rawSettings.rankingMode as StoredLeaguePreference['settings']['rankingMode']
  }
  const strategyRosterId = Number(rawSettings.strategyRosterId)
  if (Number.isInteger(strategyRosterId) && strategyRosterId >= 1 && strategyRosterId <= 100) {
    settings.strategyRosterId = strategyRosterId
  }
  if (['all', 'value', 'flip', 'points', 'intel'].includes(String(rawSettings.edgeFilter))) {
    settings.edgeFilter = rawSettings.edgeFilter as StoredLeaguePreference['settings']['edgeFilter']
  }
  if (rawSettings.teamDirectionOverrides && typeof rawSettings.teamDirectionOverrides === 'object' && !Array.isArray(rawSettings.teamDirectionOverrides)) {
    settings.teamDirectionOverrides = Object.fromEntries(
      Object.entries(rawSettings.teamDirectionOverrides as Record<string, unknown>)
        .filter(([rosterId, direction]) => /^\d{1,3}$/.test(rosterId) && ['contender', 'retooling', 'rebuilding'].includes(String(direction)))
        .slice(0, 100),
    ) as Record<string, 'contender' | 'retooling' | 'rebuilding'>
  }
  if (rawSettings.teamStrategy && typeof rawSettings.teamStrategy === 'object' && !Array.isArray(rawSettings.teamStrategy)) {
    const strategy = rawSettings.teamStrategy as Record<string, unknown>
    const mode = String(strategy.mode)
    const horizonYears = Number(strategy.horizonYears)
    const flipPriority = Number(strategy.flipPriority)
    if (
      ['auto', 'contender', 'retooling', 'rebuilding'].includes(mode)
      && [1, 2, 3, 4].includes(horizonYears)
      && Number.isFinite(flipPriority)
      && flipPriority >= 0
      && flipPriority <= 1
    ) {
      settings.teamStrategy = {
        mode: mode as NonNullable<StoredLeaguePreference['settings']['teamStrategy']>['mode'],
        horizonYears: horizonYears as 1 | 2 | 3 | 4,
        flipPriority,
      }
    }
  }
  if (rawSettings.tradeModelWeights && typeof rawSettings.tradeModelWeights === 'object' && !Array.isArray(rawSettings.tradeModelWeights)) {
    const weights = rawSettings.tradeModelWeights as Record<string, unknown>
    const market = Number(weights.market)
    const lineup = Number(weights.lineup)
    const exchange = Number(weights.exchange)
    const outcome = Number(weights.outcome)
    const outcomeHorizon = Number(weights.outcomeHorizon)
    const outcomeVariant = String(weights.outcomeVariant)
    if (
      [market, lineup, exchange, outcome].every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 100)
      && [90, 180, 365].includes(outcomeHorizon)
      && ['structureOnly', 'premiumAware'].includes(outcomeVariant)
    ) {
      settings.tradeModelWeights = {
        market,
        lineup,
        exchange,
        outcome,
        outcomeHorizon: outcomeHorizon as 90 | 180 | 365,
        outcomeVariant: outcomeVariant as 'structureOnly' | 'premiumAware',
      }
    }
  }
  return { leagueId, leagueName, myRosterId, watchlist, settings }
}

export async function listLeaguePreferences(
  db: D1Database,
  userId: string,
): Promise<StoredLeaguePreference[]> {
  const rows = await db.prepare(`SELECT league_id, league_name, my_roster_id, watchlist_json, settings_json, updated_at
FROM user_league_preferences
WHERE user_id = ?
ORDER BY updated_at DESC`).bind(userId).all<PreferenceRow>()
  return rows.results.map(preferenceFromRow)
}

export async function getLeaguePreference(
  db: D1Database,
  userId: string,
  leagueId: string,
): Promise<StoredLeaguePreference | null> {
  const row = await db.prepare(`SELECT league_id, league_name, my_roster_id, watchlist_json, settings_json, updated_at
FROM user_league_preferences
WHERE user_id = ? AND league_id = ?`).bind(userId, leagueId).first<PreferenceRow>()
  return row ? preferenceFromRow(row) : null
}

export async function saveLeaguePreference(
  db: D1Database,
  userId: string,
  preference: Omit<StoredLeaguePreference, 'updatedAt'>,
): Promise<StoredLeaguePreference> {
  const updatedAt = new Date().toISOString()
  await db.prepare(`INSERT INTO user_league_preferences (
  user_id, league_id, league_name, my_roster_id, watchlist_json, settings_json, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, league_id) DO UPDATE SET
  league_name = excluded.league_name,
  my_roster_id = excluded.my_roster_id,
  watchlist_json = excluded.watchlist_json,
  settings_json = excluded.settings_json,
  updated_at = excluded.updated_at`).bind(
    userId,
    preference.leagueId,
    preference.leagueName,
    preference.myRosterId,
    JSON.stringify(preference.watchlist),
    JSON.stringify(preference.settings),
    updatedAt,
  ).run()
  return { ...preference, updatedAt }
}
