import { normalizeNflTeam, type WeeklyGame, type WeeklyPosition, type WeeklyProjection, type WeeklyProjectionBundle } from '../src/weekly-lineup'

const WEEKLY_URL = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/fp_latest_weekly.csv'
const IDS_URL = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'
const SCHEDULE_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
const SOURCE_URL = 'https://github.com/dynastyprocess/data'
const CACHE_MS = 30 * 60 * 1000

type CachedSources = { expiresAt: number; value: Promise<[string, string, string]> }
let sourcesCache: CachedSources | null = null

export function resetWeeklyLineupProviderCacheForTest(): void {
  sourcesCache = null
}

async function textResponse(url: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url, { headers: { Accept: 'text/csv', 'User-Agent': 'RosterLab weekly lineup research' } })
  if (!response.ok) throw new Error(`Weekly lineup source failed (${response.status})`)
  return response.text()
}

async function sourceTexts(fetcher: typeof fetch): Promise<[string, string, string]> {
  if (sourcesCache && sourcesCache.expiresAt > Date.now()) return sourcesCache.value
  const value = Promise.all([
    textResponse(WEEKLY_URL, fetcher),
    textResponse(IDS_URL, fetcher),
    textResponse(SCHEDULE_URL, fetcher),
  ])
  sourcesCache = { expiresAt: Date.now() + CACHE_MS, value }
  void value.catch(() => {
    if (sourcesCache?.value === value) sourcesCache = null
  })
  return value
}

/** Small RFC-4180-compatible parser for the bounded public CSV inputs. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      if (row.some((cell) => cell.length > 0)) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''))
    if (row.some((cell) => cell.length > 0)) rows.push(row)
  }
  return rows
}

function columns(rows: string[][]): { header: Map<string, number>; body: string[][] } {
  const [names = [], ...body] = rows
  return { header: new Map(names.map((name, index) => [name, index])), body }
}

function get(row: string[], header: Map<string, number>, name: string): string {
  const index = header.get(name)
  return index === undefined ? '' : row[index] ?? ''
}

function nullable(value: string): string | null {
  const clean = value.trim()
  return !clean || clean.toUpperCase() === 'NA' ? null : clean
}

function number(value: string): number | null {
  const clean = nullable(value)
  if (clean === null) return null
  const parsed = Number(clean)
  return Number.isFinite(parsed) ? parsed : null
}

function weeklyPosition(page: string): WeeklyPosition | null {
  if (page === 'qb') return 'QB'
  if (page === 'ppr-rb') return 'RB'
  if (page === 'ppr-wr') return 'WR'
  if (page === 'ppr-te') return 'TE'
  if (page === 'k') return 'K'
  if (page === 'dst') return 'DEF'
  return null
}

function latestDate(rows: string[][], header: Map<string, number>): string | null {
  return rows.map((row) => nullable(get(row, header, 'scrape_date')))
    .filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(`${value}T00:00:00Z`))))
    .sort()
    .at(-1) ?? null
}

function playerIds(rows: string[][]): Map<string, string> {
  const { header, body } = columns(rows)
  const result = new Map<string, string>()
  body.forEach((row) => {
    const fantasyPros = nullable(get(row, header, 'fantasypros_id'))
    const sleeper = nullable(get(row, header, 'sleeper_id'))
    if (fantasyPros && sleeper && /^\d+$/.test(sleeper)) result.set(fantasyPros, sleeper)
  })
  return result
}

function buildProjections(rows: string[][], ids: Map<string, string>): { projections: Record<string, WeeklyProjection>; sourceRows: number } {
  const { header, body } = columns(rows)
  const projections: Record<string, WeeklyProjection> = {}
  let sourceRows = 0
  body.forEach((row) => {
    const position = weeklyPosition(get(row, header, 'page'))
    const points = number(get(row, header, 'r2p_pts'))
    if (!position || points === null) return
    sourceRows += 1
    const team = normalizeNflTeam(nullable(get(row, header, 'team')))
    const fantasyProsId = nullable(get(row, header, 'fantasypros_id'))
    const sleeperId = fantasyProsId ? ids.get(fantasyProsId) ?? null : null
    const playerId = position === 'DEF' && team ? `DEF:${team}` : sleeperId
    if (!playerId || projections[playerId]) return
    projections[playerId] = {
      playerId,
      name: nullable(get(row, header, 'player_name')) ?? playerId,
      position,
      team,
      points,
      rank: number(get(row, header, 'rank')),
      positionRank: nullable(get(row, header, 'pos_rank')),
      ecr: number(get(row, header, 'ecr')),
      expertSd: number(get(row, header, 'sd')),
      bestRank: number(get(row, header, 'best')),
      worstRank: number(get(row, header, 'worst')),
      opponent: nullable(get(row, header, 'player_opponent')),
      tag: nullable(get(row, header, 'tag')),
      grade: nullable(get(row, header, 'start_sit_grade')),
    }
  })
  return { projections, sourceRows }
}

function buildSchedule(rows: string[][], season: number, week: number): Record<string, WeeklyGame> {
  const { header, body } = columns(rows)
  const games: Record<string, WeeklyGame> = {}
  body.forEach((row) => {
    if (number(get(row, header, 'season')) !== season || number(get(row, header, 'week')) !== week) return
    if (get(row, header, 'game_type') !== 'REG') return
    const away = normalizeNflTeam(get(row, header, 'away_team'))
    const home = normalizeNflTeam(get(row, header, 'home_team'))
    const gameday = nullable(get(row, header, 'gameday'))
    const gametime = nullable(get(row, header, 'gametime'))
    if (!away || !home || !gameday || !gametime) return
    const kickoffOrder = `${gameday}T${gametime.padStart(5, '0')}`
    games[away] = { team: away, opponent: home, home: false, gameday, gametime, kickoffOrder }
    games[home] = { team: home, opponent: away, home: true, gameday, gametime, kickoffOrder }
  })
  return games
}

function sourceMatchesRequestedWeek(sourceDate: string | null, games: Record<string, WeeklyGame>): boolean {
  if (!sourceDate) return false
  const sourceTime = Date.parse(`${sourceDate}T12:00:00Z`)
  const firstGame = Object.values(games)
    .map((game) => Date.parse(`${game.gameday}T12:00:00Z`))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0]
  if (!Number.isFinite(sourceTime) || !Number.isFinite(firstGame)) return false
  const daysBeforeFirstGame = (firstGame - sourceTime) / (24 * 60 * 60 * 1000)
  return daysBeforeFirstGame >= -2 && daysBeforeFirstGame <= 10
}

export async function fetchWeeklyProjectionBundle(
  season: number,
  week: number,
  fetcher: typeof fetch = fetch,
): Promise<WeeklyProjectionBundle> {
  const [weeklyText, idsText, scheduleText] = await sourceTexts(fetcher)
  const weeklyRows = parseCsv(weeklyText)
  const { header: weeklyHeader, body: weeklyBody } = columns(weeklyRows)
  const sourceDate = latestDate(weeklyBody, weeklyHeader)
  const games = buildSchedule(parseCsv(scheduleText), season, week)
  const scheduleTeams = Object.keys(games).length
  const scheduleComplete = scheduleTeams >= 26
  const warnings: string[] = []

  if (!sourceMatchesRequestedWeek(sourceDate, games)) {
    warnings.push(`The Week ${week} ${season} consensus has not been published yet; lineup points fall back to RosterLab's preseason production model where covered.`)
    if (!scheduleComplete) warnings.push('The NFL schedule is incomplete, so bye-week exclusions are not active.')
    return {
      season,
      week,
      status: 'not-published',
      generatedAt: new Date().toISOString(),
      sourceDate,
      source: { name: 'DynastyProcess weekly FantasyPros consensus', url: SOURCE_URL, pointMethod: 'rank-to-points' },
      projections: {},
      games,
      scheduleComplete,
      coverage: { sourceRows: 0, matchedSleeperPlayers: 0, scheduleTeams },
      warnings,
    }
  }

  const built = buildProjections(weeklyRows, playerIds(parseCsv(idsText)))
  const matchedSleeperPlayers = Object.keys(built.projections).length
  const status: WeeklyProjectionBundle['status'] = built.sourceRows >= 100 && matchedSleeperPlayers >= 80
    ? 'ready'
    : 'partial'
  if (status === 'partial') warnings.push(`Weekly consensus coverage is partial (${matchedSleeperPlayers} matched players); uncovered players remain explicit.`)
  if (!scheduleComplete) warnings.push('The NFL schedule is incomplete, so bye-week exclusions are not active.')
  return {
    season,
    week,
    status,
    generatedAt: new Date().toISOString(),
    sourceDate,
    source: { name: 'DynastyProcess weekly FantasyPros consensus', url: SOURCE_URL, pointMethod: 'rank-to-points' },
    projections: built.projections,
    games,
    scheduleComplete,
    coverage: { sourceRows: built.sourceRows, matchedSleeperPlayers, scheduleTeams },
    warnings,
  }
}
