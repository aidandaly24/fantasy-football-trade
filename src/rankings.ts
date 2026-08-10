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
  liquidityRaw: 0,
  marketRaw: 0,
  lineup: 0,
  core: 0,
  depth: 0,
  picks: 0,
  liquidity: 0,
  market: 0,
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

const PLAYER_WEIGHTS = [1, 0.97, 0.93, 0.89, 0.84, 0.79, 0.74, 0.69, 0.64, 0.59, 0.54, 0.5, 0.46, 0.42, 0.38, 0.34]
const DEPTH_WEIGHTS = [1, 0.84, 0.7, 0.58, 0.48, 0.4]
const PICK_WEIGHTS = [1, 0.96, 0.91, 0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.5, 0.44, 0.38]

function weightedSum(values: number[], weights: number[]): number {
  return values.slice(0, weights.length).reduce((sum, value, index) => sum + value * weights[index], 0)
}

function ageResilience(asset: Asset): number {
  if (!asset.age) return 0.86
  const age = asset.age
  if (asset.position === 'QB') return age <= 29 ? 1 : age <= 31 ? 0.96 : age <= 33 ? 0.88 : 0.76
  if (asset.position === 'RB') return age <= 23 ? 1 : age <= 24 ? 0.94 : age <= 25 ? 0.86 : age <= 26 ? 0.76 : 0.64
  if (asset.position === 'WR') return age <= 25 ? 1 : age <= 26 ? 0.96 : age <= 27 ? 0.91 : age <= 28 ? 0.84 : 0.73
  if (asset.position === 'TE') return age <= 26 ? 1 : age <= 27 ? 0.96 : age <= 28 ? 0.91 : age <= 29 ? 0.84 : 0.74
  return 0.8
}

function replacementLevels(teams: Team[]): Map<Asset['position'], number> {
  const levels = new Map<Asset['position'], number>()
  const positions: Asset['position'][] = ['QB', 'RB', 'WR', 'TE']

  positions.forEach((position) => {
    const values = teams
      .flatMap((team) => team.players)
      .filter((asset) => asset.position === position)
      .map((asset) => asset.value)
      .sort((a, b) => b - a)
    const starterCount = teams.flatMap((team) => team.optimizedStarters).filter((asset) => asset.position === position).length
    const replacementIndex = Math.min(values.length - 1, Math.max(0, starterCount + Math.floor(teams.length / 2) - 1))
    levels.set(position, values[replacementIndex] ?? 0)
  })

  return levels
}

function rawMetrics(
  team: Team,
  replacement: Map<Asset['position'], number>,
  expectedStarters: number,
): Pick<TeamMetrics, 'lineupRaw' | 'coreRaw' | 'depthRaw' | 'picksRaw' | 'liquidityRaw' | 'marketRaw'> {
  const starters = team.optimizedStarters
  const starterIds = new Set(starters.map((asset) => asset.id))
  const skillPlayers = team.players
    .filter((asset) => SKILL_POSITIONS.has(asset.position))
    .sort((a, b) => b.value - a.value)
  const bench = skillPlayers.filter((asset) => !starterIds.has(asset.id))
  const starterSurplus = starters.map((asset) => {
    const baseline = replacement.get(asset.position) ?? 0
    return Math.max(0, asset.value - baseline * 0.45)
  })
  const depthSurplus = bench
    .map((asset) => Math.max(0, asset.value - (replacement.get(asset.position) ?? 0)))
    .sort((a, b) => b - a)
  const marketPlayers = skillPlayers.map((asset) => asset.value)
  const liquidAssets = [...skillPlayers, ...team.picks]
    .map((asset) => asset.value)
    .sort((a, b) => b - a)

  return {
    lineupRaw: starterSurplus.reduce((sum, value) => sum + value, 0) / Math.max(1, expectedStarters),
    coreRaw: weightedSum(
      skillPlayers.map((asset) => asset.value),
      PLAYER_WEIGHTS.slice(0, 10),
    ) * 0.25 + weightedSum(
      skillPlayers.map((asset) => asset.value * ageResilience(asset)),
      PLAYER_WEIGHTS.slice(0, 10),
    ) * 0.75,
    depthRaw: weightedSum(depthSurplus, DEPTH_WEIGHTS),
    picksRaw: weightedSum(team.picks.map((asset) => asset.value), PICK_WEIGHTS),
    liquidityRaw: weightedSum(liquidAssets.slice(3), PLAYER_WEIGHTS.slice(0, 10)),
    marketRaw: weightedSum(marketPlayers, PLAYER_WEIGHTS) + weightedSum(team.picks.map((asset) => asset.value), PICK_WEIGHTS) * 0.72,
  }
}

function leaguePercentile(values: number[], value: number): number {
  if (values.length <= 1) return 50
  const below = values.filter((item) => item < value).length
  const tied = values.filter((item) => item === value).length
  const percentile = (below + Math.max(0, tied - 1) / 2) / (values.length - 1)
  return 15 + percentile * 80
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)))
}

export function scoreTeams(teams: Team[]): Team[] {
  const replacement = replacementLevels(teams)
  const expectedStarters = Math.max(1, ...teams.map((team) => team.optimizedStarters.length))
  const raw = teams.map((team) => rawMetrics(team, replacement, expectedStarters))
  const fields = ['lineupRaw', 'coreRaw', 'depthRaw', 'picksRaw', 'liquidityRaw', 'marketRaw'] as const
  const ranges = Object.fromEntries(
    fields.map((field) => [field, raw.map((metrics) => metrics[field])]),
  ) as Record<(typeof fields)[number], number[]>

  return teams.map((team, index) => {
    const current = raw[index]
    const lineup = leaguePercentile(ranges.lineupRaw, current.lineupRaw)
    const core = leaguePercentile(ranges.coreRaw, current.coreRaw)
    const depth = leaguePercentile(ranges.depthRaw, current.depthRaw)
    const picks = leaguePercentile(ranges.picksRaw, current.picksRaw)
    const liquidity = leaguePercentile(ranges.liquidityRaw, current.liquidityRaw)
    const market = leaguePercentile(ranges.marketRaw, current.marketRaw)
    const metrics: TeamMetrics = {
      ...current,
      lineup: roundScore(lineup),
      core: roundScore(core),
      depth: roundScore(depth),
      picks: roundScore(picks),
      liquidity: roundScore(liquidity),
      market: roundScore(market),
      overall: roundScore(lineup * 0.43 + market * 0.25 + depth * 0.12 + core * 0.12 + picks * 0.08),
      contender: roundScore(lineup * 0.8 + depth * 0.15 + liquidity * 0.05),
      future: roundScore(core * 0.45 + picks * 0.35 + liquidity * 0.2),
    }
    return { ...team, metrics }
  })
}

export function rosterProfile(team: Team, teams: Team[]): { label: string; description: string } {
  const rank = (field: keyof Pick<TeamMetrics, 'overall' | 'lineup' | 'depth' | 'future' | 'picks'>) =>
    [...teams].sort((a, b) => b.metrics[field] - a.metrics[field]).findIndex((item) => item.rosterId === team.rosterId) + 1
  const overall = rank('overall')
  const lineup = rank('lineup')
  const depth = rank('depth')
  const future = rank('future')
  const picks = rank('picks')

  if (lineup <= 3 && future <= 4) {
    return { label: 'Two-window strength', description: `The lineup ranks #${lineup} and the two-year asset base ranks #${future}.` }
  }
  if (lineup <= 4 && depth >= Math.max(8, teams.length - 3)) {
    return { label: 'High ceiling, low cover', description: `The lineup ranks #${lineup}, but replacement-adjusted depth falls to #${depth}.` }
  }
  if (lineup <= 4 && picks >= Math.max(8, teams.length - 3)) {
    return { label: 'Starter-heavy build', description: `The lineup ranks #${lineup}; draft capital ranks #${picks}, limiting optionality.` }
  }
  if (picks <= 3 && lineup >= Math.ceil(teams.length / 2)) {
    return { label: 'Capital-first build', description: `Draft capital ranks #${picks}, while the current lineup sits #${lineup}.` }
  }
  if (future <= 3 && lineup >= Math.ceil(teams.length / 2)) {
    return { label: 'Young value, thinner lineup', description: `The two-year asset base ranks #${future}; the current lineup ranks #${lineup}.` }
  }
  if (depth <= 3 && lineup >= Math.ceil(teams.length / 2)) {
    return { label: 'Deep, star-light', description: `Depth ranks #${depth}, but the best legal lineup ranks #${lineup}.` }
  }
  if (overall <= 4) {
    return { label: 'Upper-tier balance', description: `The roster is #${overall} overall without a single category doing all the work.` }
  }
  if (overall >= Math.max(8, teams.length - 3) && picks >= Math.max(8, teams.length - 3)) {
    return { label: 'Low-leverage roster', description: `Overall strength ranks #${overall} and draft capital ranks #${picks}; create flexibility first.` }
  }
  return { label: 'Middle-tier leverage', description: `Overall strength ranks #${overall}; lineup #${lineup} and draft capital #${picks} show the clearest trade-offs.` }
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
