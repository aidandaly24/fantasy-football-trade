import type {
  Asset,
  LeagueBundle,
  LeagueUser,
  PickValue,
  SleeperPlayer,
  Team,
  TeamMetrics,
  TradyrPlayer,
  TradedPick,
  ValueBundle,
} from './types'
import { sleeperAvatar } from './api'

const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE'])
const EMPTY_METRICS: TeamMetrics = {
  lineupRaw: 0,
  coreRaw: 0,
  depthRaw: 0,
  picksRaw: 0,
  lineup: 0,
  core: 0,
  depth: 0,
  picks: 0,
  overall: 0,
  contender: 0,
  future: 0,
}

function userForOwner(users: LeagueUser[], ownerId: string | null): LeagueUser | undefined {
  return users.find((user) => user.user_id === ownerId)
}

function playerName(player: SleeperPlayer | undefined, id: string): string {
  if (!player) return `Player ${id}`
  if (player.full_name) return player.full_name
  return [player.first_name, player.last_name].filter(Boolean).join(' ') || `Player ${id}`
}

function toAsset(
  id: string,
  tradyr: TradyrPlayer | undefined,
  sleeper: SleeperPlayer | undefined,
  flags: { isStarter: boolean; isTaxi: boolean; isReserve: boolean },
): Asset {
  const isDefense = !/^\d+$/.test(id)
  const position = isDefense
    ? 'DEF'
    : (tradyr?.position ?? sleeper?.position ?? sleeper?.fantasy_positions?.[0] ?? 'NA')

  return {
    id,
    name: tradyr?.name ?? (isDefense ? `${id} Defense` : playerName(sleeper, id)),
    kind: 'player',
    position: (['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(position) ? position : 'NA') as Asset['position'],
    team: tradyr?.team ?? sleeper?.team ?? (isDefense ? id : null),
    value: tradyr?.composite ?? 0,
    confidence: tradyr?.confidence ?? 0,
    age: tradyr?.age ?? sleeper?.age ?? null,
    rank: tradyr?.rank ?? null,
    sourceValue: tradyr?.sources.ktc,
    ...flags,
  }
}

function ordinal(round: number): string {
  if (round === 1) return '1st'
  if (round === 2) return '2nd'
  if (round === 3) return '3rd'
  return `${round}th`
}

function getPickValue(
  values: PickValue[],
  year: number,
  round: number,
  slot: number,
): PickValue | undefined {
  const id = `pick_${year}_${round}_${String(slot).padStart(2, '0')}`
  return values.find((pick) => pick.id === id)
}

export function buildOwnedPicks(options: {
  season: number
  rounds: number
  rosterIds: number[]
  tradedPicks: TradedPick[]
  pickValues: PickValue[]
  slotToRosterId?: Record<string, number> | null
  teamNames: Map<number, string>
}): Map<number, Asset[]> {
  const owned = new Map<number, Asset[]>()
  const currentOwners = new Map<string, number>()

  options.tradedPicks.forEach((pick) => {
    currentOwners.set(`${pick.season}:${pick.round}:${pick.roster_id}`, pick.owner_id)
  })

  const slotsByRoster = new Map<number, number>()
  Object.entries(options.slotToRosterId ?? {}).forEach(([slot, rosterId]) => {
    slotsByRoster.set(rosterId, Number(slot))
  })
  const midSlot = Math.max(1, Math.ceil(options.rosterIds.length / 2))

  for (let year = options.season; year <= options.season + 2; year += 1) {
    for (const originalRosterId of options.rosterIds) {
      for (let round = 1; round <= options.rounds; round += 1) {
        const key = `${year}:${round}:${originalRosterId}`
        const ownerRosterId = currentOwners.get(key) ?? originalRosterId
        const exactSlot = year === options.season ? slotsByRoster.get(originalRosterId) : undefined
        const valueSlot = exactSlot ?? midSlot
        const marketPick = getPickValue(options.pickValues, year, round, valueSlot)
        const originalTeam = options.teamNames.get(originalRosterId) ?? `Team ${originalRosterId}`
        const exactLabel = exactSlot
          ? `${year} ${round}.${String(exactSlot).padStart(2, '0')}`
          : `${year} ${ordinal(round)}`
        const asset: Asset = {
          id: `pick:${year}:${round}:${originalRosterId}`,
          name: exactSlot ? exactLabel : `${exactLabel} · from ${originalTeam}`,
          shortName: exactLabel,
          kind: 'pick',
          position: 'PICK',
          team: null,
          value: marketPick?.composite ?? 0,
          confidence: exactSlot ? 0.95 : 0.68,
          age: null,
          rank: null,
          sourceValue: null,
          originalRosterId,
          ownerRosterId,
          year: String(year),
          round,
          slot: exactSlot,
        }
        const list = owned.get(ownerRosterId) ?? []
        list.push(asset)
        owned.set(ownerRosterId, list)
      }
    }
  }

  owned.forEach((picks) => {
    picks.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
  })
  return owned
}

function takeBest(pool: Asset[], position: string): Asset | undefined {
  const eligible = pool
    .filter((asset) => {
      if (position === 'FLEX') return ['RB', 'WR', 'TE'].includes(asset.position)
      if (position === 'SUPER_FLEX') return SKILL_POSITIONS.has(asset.position)
      return asset.position === position
    })
    .sort((a, b) => b.value - a.value)[0]
  if (!eligible) return undefined
  pool.splice(
    pool.findIndex((asset) => asset.id === eligible.id),
    1,
  )
  return eligible
}

export function optimizeLineup(players: Asset[], rosterPositions: string[]): Asset[] {
  const pool = players.filter((player) => SKILL_POSITIONS.has(player.position))
  const selected: Asset[] = []
  const required = rosterPositions.filter((position) => SKILL_POSITIONS.has(position))
  const flex = rosterPositions.filter((position) => position === 'FLEX')
  const superFlex = rosterPositions.filter((position) => position === 'SUPER_FLEX')

  ;[...required, ...flex, ...superFlex].forEach((position) => {
    const best = takeBest(pool, position)
    if (best) selected.push(best)
  })
  return selected
}

function weightedAverage(values: number[], weights: number[]): number {
  if (!values.length) return 0
  const padded = Array.from({ length: weights.length }, (_, index) => values[index] ?? 0)
  const weighted = padded.reduce((sum, value, index) => sum + value * weights[index], 0)
  return weighted / weights.reduce((sum, weight) => sum + weight, 0)
}

function rawMetrics(team: Team): Pick<TeamMetrics, 'lineupRaw' | 'coreRaw' | 'depthRaw' | 'picksRaw'> {
  const starters = team.optimizedStarters
  const starterIds = new Set(starters.map((asset) => asset.id))
  const skillPlayers = team.players
    .filter((asset) => SKILL_POSITIONS.has(asset.position))
    .sort((a, b) => b.value - a.value)
  const bench = skillPlayers.filter((asset) => !starterIds.has(asset.id))

  return {
    lineupRaw: weightedAverage(
      starters.map((asset) => asset.value),
      Array(Math.max(1, starters.length)).fill(1),
    ),
    coreRaw: weightedAverage(
      skillPlayers.map((asset) => asset.value),
      [1.2, 1.12, 1.04, 0.96, 0.88, 0.8, 0.72, 0.64],
    ),
    depthRaw: weightedAverage(
      bench.map((asset) => asset.value),
      [1, 0.88, 0.76, 0.66, 0.56, 0.48],
    ),
    picksRaw: weightedAverage(
      team.picks.map((asset) => asset.value),
      [1, 0.95, 0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42],
    ),
  }
}

function normalized(values: number[], value: number): number {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return 75
  return 35 + ((value - min) / (max - min)) * 65
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)))
}

export function scoreTeams(teams: Team[]): Team[] {
  const raw = teams.map(rawMetrics)
  const fields = ['lineupRaw', 'coreRaw', 'depthRaw', 'picksRaw'] as const
  const ranges = Object.fromEntries(
    fields.map((field) => [field, raw.map((metrics) => metrics[field])]),
  ) as Record<(typeof fields)[number], number[]>

  return teams.map((team, index) => {
    const current = raw[index]
    const lineup = normalized(ranges.lineupRaw, current.lineupRaw)
    const core = normalized(ranges.coreRaw, current.coreRaw)
    const depth = normalized(ranges.depthRaw, current.depthRaw)
    const picks = normalized(ranges.picksRaw, current.picksRaw)
    const metrics: TeamMetrics = {
      ...current,
      lineup: roundScore(lineup),
      core: roundScore(core),
      depth: roundScore(depth),
      picks: roundScore(picks),
      overall: roundScore(lineup * 0.45 + core * 0.25 + depth * 0.15 + picks * 0.15),
      contender: roundScore(lineup * 0.72 + depth * 0.18 + core * 0.1),
      future: roundScore(core * 0.58 + picks * 0.42),
    }
    return { ...team, metrics }
  })
}

export function buildTeams(
  leagueBundle: LeagueBundle,
  values: ValueBundle,
  sleeperPlayers: Map<string, SleeperPlayer>,
): Team[] {
  const tradyrById = new Map(
    values.players.filter((player) => player.sleeperId).map((player) => [player.sleeperId!, player]),
  )
  const teamNames = new Map<number, string>()

  leagueBundle.rosters.forEach((roster) => {
    const user = userForOwner(leagueBundle.users, roster.owner_id)
    teamNames.set(roster.roster_id, user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`)
  })

  const ownedPicks = buildOwnedPicks({
    season: Number(leagueBundle.league.season),
    rounds: leagueBundle.league.settings.draft_rounds || 3,
    rosterIds: leagueBundle.rosters.map((roster) => roster.roster_id),
    tradedPicks: leagueBundle.tradedPicks,
    pickValues: values.picks,
    slotToRosterId: leagueBundle.draft?.slot_to_roster_id,
    teamNames,
  })

  const teams: Team[] = leagueBundle.rosters.map((roster) => {
    const user = userForOwner(leagueBundle.users, roster.owner_id)
    const starterIds = new Set(roster.starters ?? [])
    const taxiIds = new Set(roster.taxi ?? [])
    const reserveIds = new Set(roster.reserve ?? [])
    const players = (roster.players ?? [])
      .filter((id) => id !== '0')
      .map((id) =>
        toAsset(id, tradyrById.get(id), sleeperPlayers.get(id), {
          isStarter: starterIds.has(id),
          isTaxi: taxiIds.has(id),
          isReserve: reserveIds.has(id),
        }),
      )
      .sort((a, b) => b.value - a.value)
    const team: Team = {
      rosterId: roster.roster_id,
      ownerId: roster.owner_id,
      ownerName: user?.display_name ?? `Manager ${roster.roster_id}`,
      teamName: user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`,
      avatar: sleeperAvatar(user?.metadata?.avatar || user?.avatar),
      players,
      picks: ownedPicks.get(roster.roster_id) ?? [],
      optimizedStarters: [],
      metrics: { ...EMPTY_METRICS },
    }
    team.optimizedStarters = optimizeLineup(players, leagueBundle.league.roster_positions)
    return team
  })

  return scoreTeams(teams)
}

export function packageValue(assets: Asset[]): number {
  const sorted = [...assets].sort((a, b) => b.value - a.value)
  const multipliers = [1, 0.93, 0.85, 0.78, 0.72, 0.67, 0.62, 0.58]
  const total = sorted.reduce(
    (sum, asset, index) => sum + asset.value * (multipliers[index] ?? 0.55),
    0,
  )
  const eliteBonus = sorted[0] ? Math.max(0, sorted[0].value - 700) * 0.18 : 0
  return Math.round(total + eliteBonus)
}

export function evaluateTrade(sideA: Asset[], sideB: Asset[]) {
  const valueA = packageValue(sideA)
  const valueB = packageValue(sideB)
  const total = valueA + valueB
  const shareA = total ? (valueA / total) * 100 : 50
  const difference = total ? (Math.abs(valueA - valueB) / ((valueA + valueB) / 2)) * 100 : 0
  const leader = valueA >= valueB ? 'A' : 'B'
  const verdict =
    sideA.length === 0 || sideB.length === 0
      ? 'Build both sides'
      : difference <= 6
        ? 'Dead even'
        : difference <= 14
          ? 'Fair framework'
          : difference <= 26
            ? `Leans Side ${leader}`
            : `Strongly favors Side ${leader}`

  return {
    valueA,
    valueB,
    shareA,
    difference,
    verdict,
    fair: sideA.length > 0 && sideB.length > 0 && difference <= 14,
  }
}

export function leagueFormat(bundle: LeagueBundle): { numQbs: 1 | 2; tep: boolean } {
  const superflex = bundle.league.roster_positions.includes('SUPER_FLEX')
  const qbs = bundle.league.roster_positions.filter((slot) => slot === 'QB').length
  return {
    numQbs: superflex || qbs > 1 ? 2 : 1,
    tep: (bundle.league.scoring_settings.bonus_rec_te ?? 0) > 0,
  }
}
