/**
 * Pure Sleeper journal collection helpers. Persistence is deliberately kept out
 * of this module so the Worker route can choose D1 batching/transactions.
 */

export type JournalLeague = {
  league_id: string
  season: string
  name?: string
  previous_league_id?: string | null
}

export type JournalUser = {
  user_id: string
  display_name: string
  avatar?: string | null
  metadata?: { team_name?: string } | null
}

export type JournalRoster = {
  roster_id: number
  owner_id: string | null
  players?: string[] | null
  starters?: string[] | null
  reserve?: string[] | null
  taxi?: string[] | null
}

export type JournalPick = {
  season: string
  round: number
  roster_id: number
  owner_id: number
  previous_owner_id: number
}

export type JournalTransaction = {
  transaction_id: string
  type: string
  status: string
  created: number
  status_updated: number
  roster_ids: number[]
  consenter_ids: number[]
  adds: Record<string, number> | null
  drops: Record<string, number> | null
  draft_picks: JournalPick[]
}

export interface SleeperJournalClient {
  getLeague(leagueId: string): Promise<JournalLeague>
  getUsers(leagueId: string): Promise<JournalUser[]>
  getRosters(leagueId: string): Promise<JournalRoster[]>
  getTransactions(leagueId: string, week: number): Promise<JournalTransaction[]>
}

export type CoverageTarget = {
  leagueId: string
  type: 'league' | 'users' | 'rosters' | 'transactions'
  key: string
  status: 'complete' | 'failed'
  error: string | null
}

export type SeasonIdentity = {
  leagueId: string
  rosterId: number
  ownerUserId: string | null
  ownerDisplayName: string | null
  teamName: string | null
}

export type SeasonRosterSnapshot = {
  leagueId: string
  rosterId: number
  ownerUserId: string | null
  players: string[]
  starters: string[]
  reserve: string[]
  taxi: string[]
}

export type JournalAssetLeg = {
  kind: 'player' | 'pick'
  assetKey: string
  fromRosterId: number | null
  toRosterId: number | null
  playerId?: string
  pick?: JournalPick
}

export type NormalizedTrade = {
  leagueId: string
  transactionId: string
  season: string
  week: number
  createdAtMs: number
  statusUpdatedAtMs: number
  rosterIds: number[]
  consenterIds: number[]
  raw: JournalTransaction
  assets: JournalAssetLeg[]
}

export type JournalCollection = {
  rootLeagueId: string
  seasons: JournalLeague[]
  identities: SeasonIdentity[]
  seasonRosters: SeasonRosterSnapshot[]
  trades: NormalizedTrade[]
  coverage: CoverageTarget[]
  complete: boolean
}

const WEEKS = Array.from({ length: 19 }, (_, index) => index)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function covered<T>(
  coverage: CoverageTarget[], leagueId: string, type: CoverageTarget['type'], key: string, work: () => Promise<T>,
): Promise<T | null> {
  try {
    const value = await work()
    coverage.push({ leagueId, type, key, status: 'complete', error: null })
    return value
  } catch (error) {
    coverage.push({ leagueId, type, key, status: 'failed', error: errorMessage(error) })
    return null
  }
}

/** Converts a Sleeper trade into stable, sortable player and pick legs. */
export function normalizeTrade(league: JournalLeague, week: number, transaction: JournalTransaction): NormalizedTrade {
  const playerIds = [...new Set([...Object.keys(transaction.adds ?? {}), ...Object.keys(transaction.drops ?? {})])]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const assets: JournalAssetLeg[] = [
    ...playerIds.map((playerId) => ({
      kind: 'player' as const,
      assetKey: playerId,
      playerId,
      fromRosterId: transaction.drops?.[playerId] ?? null,
      toRosterId: transaction.adds?.[playerId] ?? null,
    })),
    ...[...(transaction.draft_picks ?? [])]
      .sort((a, b) => `${a.season}:${a.round}:${a.roster_id}:${a.previous_owner_id}:${a.owner_id}`.localeCompare(`${b.season}:${b.round}:${b.roster_id}:${b.previous_owner_id}:${b.owner_id}`))
      .map((pick) => ({
        kind: 'pick' as const,
        assetKey: `${pick.season}:${pick.round}:${pick.roster_id}`,
        fromRosterId: pick.previous_owner_id,
        toRosterId: pick.owner_id,
        pick,
      })),
  ]
  return {
    leagueId: league.league_id,
    transactionId: transaction.transaction_id,
    season: league.season,
    week,
    createdAtMs: transaction.created,
    statusUpdatedAtMs: transaction.status_updated,
    rosterIds: [...(transaction.roster_ids ?? [])].sort((a, b) => a - b),
    consenterIds: [...(transaction.consenter_ids ?? [])].sort((a, b) => a - b),
    raw: transaction,
    assets,
  }
}

/**
 * Traverses every predecessor until the chain ends or loops. Failed targets
 * remain visible in coverage; no failed request is interpreted as an empty week.
 */
export async function collectLeagueJournal(rootLeagueId: string, client: SleeperJournalClient): Promise<JournalCollection> {
  const coverage: CoverageTarget[] = []
  const seasons: JournalLeague[] = []
  const identities: SeasonIdentity[] = []
  const seasonRosters: SeasonRosterSnapshot[] = []
  const trades = new Map<string, NormalizedTrade>()
  const visited = new Set<string>()
  let leagueId: string | null = rootLeagueId

  while (leagueId && !visited.has(leagueId)) {
    visited.add(leagueId)
    const league = await covered(coverage, leagueId, 'league', leagueId, () => client.getLeague(leagueId))
    if (!league) break
    seasons.push(league)

    const [users, rosters] = await Promise.all([
      covered(coverage, league.league_id, 'users', league.league_id, () => client.getUsers(league.league_id)),
      covered(coverage, league.league_id, 'rosters', league.league_id, () => client.getRosters(league.league_id)),
    ])
    if (rosters) {
      const usersById = new Map((users ?? []).map((user) => [user.user_id, user]))
      rosters.forEach((roster) => {
        const user = roster.owner_id ? usersById.get(roster.owner_id) : undefined
        identities.push({
          leagueId: league.league_id,
          rosterId: roster.roster_id,
          ownerUserId: roster.owner_id,
          ownerDisplayName: user?.display_name ?? null,
          teamName: user?.metadata?.team_name ?? null,
        })
        seasonRosters.push({
          leagueId: league.league_id,
          rosterId: roster.roster_id,
          ownerUserId: roster.owner_id,
          players: [...(roster.players ?? [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
          starters: [...(roster.starters ?? [])],
          reserve: [...(roster.reserve ?? [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
          taxi: [...(roster.taxi ?? [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        })
      })
    }

    const weeks = await Promise.all(WEEKS.map(async (week) => {
      const items = await covered(coverage, league.league_id, 'transactions', String(week), () => client.getTransactions(league.league_id, week))
      return { week, items }
    }))
    weeks.forEach(({ week, items }) => items?.forEach((transaction) => {
      if (transaction.type !== 'trade' || transaction.status !== 'complete') return
      const normalized = normalizeTrade(league, week, transaction)
      trades.set(`${normalized.leagueId}:${normalized.transactionId}`, normalized)
    }))
    leagueId = league.previous_league_id ?? null
  }

  if (leagueId && visited.has(leagueId)) {
    coverage.push({ leagueId, type: 'league', key: leagueId, status: 'failed', error: 'Linked-season loop detected' })
  }
  return {
    rootLeagueId,
    seasons,
    identities: identities.sort((a, b) => a.leagueId.localeCompare(b.leagueId) || a.rosterId - b.rosterId),
    seasonRosters: seasonRosters.sort((a, b) => a.leagueId.localeCompare(b.leagueId) || a.rosterId - b.rosterId),
    trades: [...trades.values()].sort((a, b) => b.createdAtMs - a.createdAtMs || a.leagueId.localeCompare(b.leagueId)),
    coverage,
    complete: coverage.every((target) => target.status === 'complete'),
  }
}
