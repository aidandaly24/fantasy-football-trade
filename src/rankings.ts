import type {
  Asset,
  LeagueBundle,
  LeagueUser,
  PickTier,
  PickValue,
  PlayerProjection,
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
  projection: PlayerProjection | undefined,
  flags: { isStarter: boolean; isTaxi: boolean; isReserve: boolean },
): Asset {
  const isDefense = !/^\d+$/.test(id)
  const usableProjection = projection && projection.gamesObserved > 0 ? projection : undefined
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
    marketSources: tradyr ? { ...tradyr.sources } : undefined,
    active: sleeper?.active,
    nflStatus: sleeper?.status,
    injuryStatus: sleeper?.injury_status,
    depthChartOrder: sleeper?.depth_chart_order,
    depthChartPosition: sleeper?.depth_chart_position,
    projectedPpg: usableProjection?.restOfSeasonPpg ?? usableProjection?.expectedPpg,
    projectedPpgFloor: usableProjection?.floorPpg,
    projectedPpgCeiling: usableProjection?.ceilingPpg,
    projectionConfidence: usableProjection?.confidence,
    productionModel: usableProjection?.productionModel,
    projectionDrivers: usableProjection?.drivers,
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

function projectedPickValue(
  values: PickValue[],
  year: number,
  round: number,
  probabilities: Record<PickTier, number>,
): { expected: number; low: number; high: number } | null {
  const candidates = values.filter((pick) => Number(pick.year) === year && pick.round === round)
  if (!candidates.length) return null

  const tierAverage = (tier: PickTier) => {
    const tierValues = candidates.filter((pick) => pick.tier === tier).map((pick) => pick.composite)
    if (!tierValues.length) return null
    return tierValues.reduce((sum, value) => sum + value, 0) / tierValues.length
  }
  const fallback = candidates.reduce((sum, pick) => sum + pick.composite, 0) / candidates.length
  const expected = (['early', 'mid', 'late'] as const).reduce(
    (sum, tier) => sum + (tierAverage(tier) ?? fallback) * probabilities[tier],
    0,
  )
  const composites = candidates.map((pick) => pick.composite)

  return {
    expected: Math.round(expected),
    low: Math.min(...composites),
    high: Math.max(...composites),
  }
}

export function buildOwnedPicks(options: {
  season: number
  seasons?: number[]
  exactSlotSeason?: number | null
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

  const seasons = options.seasons ?? [options.season, options.season + 1, options.season + 2]
  const exactSlotSeason = options.exactSlotSeason === undefined ? options.season : options.exactSlotSeason

  for (const year of seasons) {
    for (const originalRosterId of options.rosterIds) {
      for (let round = 1; round <= options.rounds; round += 1) {
        const key = `${year}:${round}:${originalRosterId}`
        const ownerRosterId = currentOwners.get(key) ?? originalRosterId
        const exactSlot = year === exactSlotSeason ? slotsByRoster.get(originalRosterId) : undefined
        const valueSlot = exactSlot ?? midSlot
        const probabilities = { early: 0, mid: 1, late: 0 }
        const projectedValue = exactSlot
          ? null
          : projectedPickValue(options.pickValues, year, round, probabilities)
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
          value: exactSlot ? (marketPick?.composite ?? 0) : (projectedValue?.expected ?? marketPick?.composite ?? 0),
          confidence: exactSlot ? 1 : 0,
          age: null,
          rank: null,
          sourceValue: null,
          originalRosterId,
          ownerRosterId,
          year: String(year),
          round,
          slot: exactSlot,
          projectedTier: exactSlot ? 'known' : 'mid',
          tierProbabilities: exactSlot ? undefined : probabilities,
          valueLow: exactSlot ? marketPick?.composite : projectedValue?.low,
          valueHigh: exactSlot ? marketPick?.composite : projectedValue?.high,
          projectionConfidence: exactSlot
            ? 1
            : 0,
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

export function futurePickContext(
  leagueBundle: LeagueBundle,
  pickValues: PickValue[],
): { firstSeason: number; seasons: number[]; exactSlotSeason: number | null } {
  const leagueSeason = Number(leagueBundle.league.season)
  const currentDraftComplete =
    leagueBundle.draft?.status === 'complete' && Number(leagueBundle.draft.season) === leagueSeason
  const firstSeason = currentDraftComplete ? leagueSeason + 1 : leagueSeason
  const marketSeasons = [...new Set(pickValues.map((pick) => Number(pick.year)))]
    .filter((season) => Number.isFinite(season) && season >= firstSeason)
    .sort((a, b) => a - b)
  const seasons = marketSeasons.length
    ? marketSeasons
    : [firstSeason, firstSeason + 1, firstSeason + 2]
  const exactSlotSeason =
    !currentDraftComplete && Number(leagueBundle.draft?.season) === firstSeason
      ? firstSeason
      : null

  return { firstSeason, seasons, exactSlotSeason }
}

export function currentRoleValue(asset: Asset): number {
  return Math.round(asset.value)
}

export function assetRoleLabel(asset: Asset): string | null {
  if (asset.kind === 'pick') return null
  if (asset.active === false) return 'Inactive'
  if (asset.depthChartOrder && ['QB', 'RB', 'WR', 'TE'].includes(asset.position)) {
    return `${asset.position}${asset.depthChartOrder}`
  }
  return null
}

export function projectedLineupPpg(asset: Asset): number {
  if (asset.kind !== 'player') return 0
  return asset.projectedPpg ?? 0
}

function takeBest(
  pool: Asset[],
  position: string,
  scoreAsset: (asset: Asset) => number,
): Asset | undefined {
  const eligible = pool
    .filter((asset) => {
      if (position === 'FLEX') return ['RB', 'WR', 'TE'].includes(asset.position)
      if (position === 'SUPER_FLEX') return SKILL_POSITIONS.has(asset.position)
      return asset.position === position
    })
    .sort((a, b) => scoreAsset(b) - scoreAsset(a) || b.value - a.value)[0]
  if (!eligible) return undefined
  pool.splice(
    pool.findIndex((asset) => asset.id === eligible.id),
    1,
  )
  return eligible
}

function optimizeLineupBy(
  players: Asset[],
  rosterPositions: string[],
  scoreAsset: (asset: Asset) => number,
): Asset[] {
  const pool = players.filter((player) => SKILL_POSITIONS.has(player.position))
  const selected: Asset[] = []
  const required = rosterPositions.filter((position) => SKILL_POSITIONS.has(position))
  const flex = rosterPositions.filter((position) => position === 'FLEX')
  const superFlex = rosterPositions.filter((position) => position === 'SUPER_FLEX')

  ;[...required, ...flex, ...superFlex].forEach((position) => {
    const best = takeBest(pool, position, scoreAsset)
    if (best) selected.push(best)
  })
  return selected
}

export function optimizeLineup(players: Asset[], rosterPositions: string[]): Asset[] {
  return optimizeLineupBy(players, rosterPositions, currentRoleValue)
}

function rawMetrics(team: Team): Pick<TeamMetrics, 'lineupRaw' | 'coreRaw' | 'depthRaw' | 'picksRaw' | 'liquidityRaw' | 'marketRaw'> {
  const starters = team.optimizedStarters
  const starterIds = new Set(starters.map((asset) => asset.id))
  const skillPlayers = team.players.filter((asset) => SKILL_POSITIONS.has(asset.position))
  const bench = skillPlayers.filter((asset) => !starterIds.has(asset.id))
  const playerMarket = skillPlayers.reduce((sum, asset) => sum + asset.value, 0)
  const pickMarket = team.picks.reduce((sum, asset) => sum + asset.value, 0)

  return {
    lineupRaw: starters.reduce((sum, asset) => sum + projectedLineupPpg(asset), 0),
    coreRaw: playerMarket,
    depthRaw: bench.reduce((sum, asset) => sum + asset.value, 0),
    picksRaw: pickMarket,
    liquidityRaw: 0,
    marketRaw: playerMarket + pickMarket,
  }
}

export function scoreTeams(teams: Team[]): Team[] {
  const raw = teams.map(rawMetrics)
  return teams.map((team, index) => {
    const current = raw[index]
    const metrics: TeamMetrics = {
      ...current,
      lineup: Number(current.lineupRaw.toFixed(1)),
      core: Math.round(current.coreRaw),
      depth: Math.round(current.depthRaw),
      picks: Math.round(current.picksRaw),
      liquidity: 0,
      market: Math.round(current.marketRaw),
      overall: Math.round(current.marketRaw),
      contender: Number(current.lineupRaw.toFixed(1)),
      future: Math.round(current.picksRaw),
    }
    return { ...team, metrics }
  })
}

/** Recomputes lineup selection and direct team metrics after a roster overlay. */
export function rebuildTeamMetrics(teams: Team[], rosterPositions: string[]): Team[] {
  return scoreTeams(teams.map((team) => ({
    ...team,
    optimizedStarters: optimizeLineupBy(team.players, rosterPositions, projectedLineupPpg),
  })))
}

export function rosterProfile(team: Team, teams: Team[]): { label: string; description: string } {
  const rank = (field: keyof Pick<TeamMetrics, 'overall' | 'lineup' | 'depth' | 'future' | 'picks'>) =>
    [...teams].sort((a, b) => b.metrics[field] - a.metrics[field]).findIndex((item) => item.rosterId === team.rosterId) + 1
  const overall = rank('overall')
  const lineup = rank('lineup')
  const depth = rank('depth')
  const picks = rank('picks')
  return {
    label: 'Observed roster snapshot',
    description: `Current market ranks #${overall}; covered lineup PPG ranks #${lineup}; bench market ranks #${depth}; draft-capital market ranks #${picks}.`,
  }
}

export function buildTeams(
  leagueBundle: LeagueBundle,
  values: ValueBundle,
  sleeperPlayers: Map<string, SleeperPlayer>,
  playerProjections: Map<string, PlayerProjection> = new Map(),
): Team[] {
  const tradyrById = new Map(
    values.players.filter((player) => player.sleeperId).map((player) => [player.sleeperId!, player]),
  )
  const teamNames = new Map<number, string>()

  leagueBundle.rosters.forEach((roster) => {
    const user = userForOwner(leagueBundle.users, roster.owner_id)
    teamNames.set(roster.roster_id, user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`)
  })

  const pickContext = futurePickContext(leagueBundle, values.picks)

  const baseTeams: Team[] = leagueBundle.rosters.map((roster) => {
    const user = userForOwner(leagueBundle.users, roster.owner_id)
    const starterIds = new Set(roster.starters ?? [])
    const taxiIds = new Set(roster.taxi ?? [])
    const reserveIds = new Set(roster.reserve ?? [])
    const players = (roster.players ?? [])
      .filter((id) => id !== '0')
      .map((id) =>
        toAsset(id, tradyrById.get(id), sleeperPlayers.get(id), playerProjections.get(id), {
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
      picks: [],
      optimizedStarters: [],
      metrics: { ...EMPTY_METRICS },
    }
    team.optimizedStarters = optimizeLineupBy(players, leagueBundle.league.roster_positions, projectedLineupPpg)
    return team
  })

  const ownedPicks = buildOwnedPicks({
    season: pickContext.firstSeason,
    seasons: pickContext.seasons,
    exactSlotSeason: pickContext.exactSlotSeason,
    rounds: leagueBundle.league.settings.draft_rounds || 3,
    rosterIds: leagueBundle.rosters.map((roster) => roster.roster_id),
    tradedPicks: leagueBundle.tradedPicks,
    pickValues: values.picks,
    slotToRosterId: pickContext.exactSlotSeason ? leagueBundle.draft?.slot_to_roster_id : null,
    teamNames,
  })
  const teams = baseTeams.map((team) => ({
    ...team,
    picks: ownedPicks.get(team.rosterId) ?? [],
  }))

  return rebuildTeamMetrics(teams, leagueBundle.league.roster_positions)
}

type PackageValueBound = 'expected' | 'low' | 'high'

function assetValueAt(asset: Asset, bound: PackageValueBound): number {
  if (bound === 'low') {
    if (asset.valueLow !== undefined) return asset.valueLow
    return asset.value
  }
  if (bound === 'high') {
    if (asset.valueHigh !== undefined) return asset.valueHigh
    return asset.value
  }
  return asset.value
}

function packageValueAt(assets: Asset[], bound: PackageValueBound): number {
  return Math.round(assets.reduce((sum, asset) => sum + assetValueAt(asset, bound), 0))
}

export function packageValue(assets: Asset[]): number {
  return packageValueAt(assets, 'expected')
}

export type TradePackageFacts = {
  currentValue: number
  lowValue: number
  highValue: number
  playerCount: number
  pickCount: number
  pickValue: number
  averageAgeNow: number | null
  averageAgeAtHorizon: number | null
  ageCoveragePercent: number
  providerCoveragePercent: number
  providerTotalsApplicable: boolean
  providerTotals: {
    ktc: number | null
    fantasycalc: number | null
  }
}

export type LineupProjectionScenario = {
  expectedDelta: number | null
  floorDelta: number | null
  ceilingDelta: number | null
  complete: boolean
  beforeCoverage: { covered: number; required: number; percent: number }
  afterCoverage: { covered: number; required: number; percent: number }
}

type ProjectionBound = 'floor' | 'expected' | 'ceiling'

function projectionAt(asset: Asset, bound: ProjectionBound): number | undefined {
  if (asset.kind !== 'player') return undefined
  if (bound === 'floor') return asset.projectedPpgFloor
  if (bound === 'ceiling') return asset.projectedPpgCeiling
  return asset.projectedPpg
}

function requiredSkillSlots(rosterPositions: string[]): number {
  return rosterPositions.filter((position) => SKILL_POSITIONS.has(position) || position === 'FLEX' || position === 'SUPER_FLEX').length
}

function lineupCoverage(players: Asset[], rosterPositions: string[], bound: ProjectionBound) {
  const required = requiredSkillSlots(rosterPositions)
  const likelyStarters = optimizeLineup(players, rosterPositions)
  const covered = likelyStarters.filter((asset) => projectionAt(asset, bound) !== undefined).length
  return {
    covered,
    required,
    percent: required ? Math.round((covered / required) * 100) : 100,
    complete: likelyStarters.length === required && covered === required,
  }
}

function projectedLineupTotalAt(players: Asset[], rosterPositions: string[], bound: ProjectionBound): number {
  return optimizeLineupBy(players, rosterPositions, (asset) => projectionAt(asset, bound) ?? 0)
    .reduce((sum, player) => sum + (projectionAt(player, bound) ?? 0), 0)
}

function postTradePlayers(
  team: Team,
  outgoing: Asset[],
  incoming: Asset[],
): Asset[] {
  const outgoingIds = new Set(outgoing.filter((asset) => asset.kind === 'player').map((asset) => asset.id))
  const remaining = team.players.filter((player) => !outgoingIds.has(player.id))
  const existingIds = new Set(remaining.map((player) => player.id))
  const additions = incoming.filter(
    (asset) => asset.kind === 'player' && !existingIds.has(asset.id),
  )
  return [...remaining, ...additions]
}

function lineupProjectionScenario(
  team: Team,
  outgoing: Asset[],
  incoming: Asset[],
  rosterPositions: string[],
): LineupProjectionScenario {
  const afterPlayers = postTradePlayers(team, outgoing, incoming)
  const beforeExpected = lineupCoverage(team.players, rosterPositions, 'expected')
  const afterExpected = lineupCoverage(afterPlayers, rosterPositions, 'expected')
  const beforeFloor = lineupCoverage(team.players, rosterPositions, 'floor')
  const afterFloor = lineupCoverage(afterPlayers, rosterPositions, 'floor')
  const beforeCeiling = lineupCoverage(team.players, rosterPositions, 'ceiling')
  const afterCeiling = lineupCoverage(afterPlayers, rosterPositions, 'ceiling')
  const delta = (bound: ProjectionBound, complete: boolean) => complete
    ? Number((projectedLineupTotalAt(afterPlayers, rosterPositions, bound) - projectedLineupTotalAt(team.players, rosterPositions, bound)).toFixed(1))
    : null

  return {
    expectedDelta: delta('expected', beforeExpected.complete && afterExpected.complete),
    floorDelta: delta('floor', beforeFloor.complete && afterFloor.complete),
    ceilingDelta: delta('ceiling', beforeCeiling.complete && afterCeiling.complete),
    complete: beforeExpected.complete && afterExpected.complete,
    beforeCoverage: {
      covered: beforeExpected.covered,
      required: beforeExpected.required,
      percent: beforeExpected.percent,
    },
    afterCoverage: {
      covered: afterExpected.covered,
      required: afterExpected.required,
      percent: afterExpected.percent,
    },
  }
}

function packageProviderTotal(assets: Asset[], provider: keyof NonNullable<Asset['marketSources']>): number | null {
  let total = 0
  for (const asset of assets) {
    if (asset.kind === 'pick') return null
    const value = asset.marketSources?.[provider]
    if (value === null || value === undefined) return null
    total += value
  }
  return Math.round(total)
}

function packageFacts(assets: Asset[], horizonYears: number): TradePackageFacts {
  const players = assets.filter((asset) => asset.kind === 'player')
  const picks = assets.filter((asset) => asset.kind === 'pick')
  const knownAges = players.flatMap((asset) => asset.age === null || asset.age === undefined ? [] : [asset.age])
  const averageAgeNow = knownAges.length
    ? Number((knownAges.reduce((sum, age) => sum + age, 0) / knownAges.length).toFixed(1))
    : null
  const providerCovered = players.filter((asset) => (
    asset.marketSources?.ktc !== null
    && asset.marketSources?.ktc !== undefined
    && asset.marketSources?.fantasycalc !== null
    && asset.marketSources?.fantasycalc !== undefined
  )).length

  return {
    currentValue: packageValueAt(assets, 'expected'),
    lowValue: packageValueAt(assets, 'low'),
    highValue: packageValueAt(assets, 'high'),
    playerCount: players.length,
    pickCount: picks.length,
    pickValue: Math.round(picks.reduce((sum, asset) => sum + asset.value, 0)),
    averageAgeNow,
    averageAgeAtHorizon: averageAgeNow === null ? null : Number((averageAgeNow + horizonYears).toFixed(1)),
    ageCoveragePercent: players.length ? Math.round((knownAges.length / players.length) * 100) : 100,
    providerCoveragePercent: players.length ? Math.round((providerCovered / players.length) * 100) : 100,
    providerTotalsApplicable: picks.length === 0,
    providerTotals: {
      ktc: packageProviderTotal(assets, 'ktc'),
      fantasycalc: packageProviderTotal(assets, 'fantasycalc'),
    },
  }
}

function packageRiskNotes(assets: Asset[]): string[] {
  return assets.flatMap((asset) => {
    if (asset.kind !== 'player') return []
    if (asset.active === false) return [`${asset.name} is inactive; the market value is not current lineup value.`]
    const role = assetRoleLabel(asset)
    if (
      role
      && asset.depthChartOrder
      && asset.depthChartOrder > 1
      && (asset.position !== 'WR' || asset.depthChartOrder >= 4)
    ) {
      return [`${asset.name} is listed ${role}; treat that price as contingent value, not a locked starter.`]
    }
    const injury = `${asset.injuryStatus ?? ''}`.trim()
    if (injury && !/^healthy$/i.test(injury)) {
      return [`${asset.name} carries a ${injury} availability tag.`]
    }
    return []
  })
}

function packageProjectionNotes(assets: Asset[]): string[] {
  return assets.flatMap((asset) => {
    if (asset.kind !== 'player' || !asset.projectionDrivers?.length) return []
    return [`${asset.name}: ${asset.projectionDrivers.join(', ')}.`]
  })
}

export function evaluateTrade(
  sideA: Asset[],
  sideB: Asset[],
  context?: { teamA?: Team; teamB?: Team; rosterPositions?: string[]; horizonYears?: number },
) {
  const horizonYears = Math.max(1, Math.min(4, context?.horizonYears ?? 2))
  const packageA = packageFacts(sideA, horizonYears)
  const packageB = packageFacts(sideB, horizonYears)
  const valueA = packageA.currentValue
  const valueB = packageB.currentValue
  const total = valueA + valueB
  const difference = total ? (Math.abs(valueA - valueB) / ((valueA + valueB) / 2)) * 100 : 0
  const marketNetA = valueB - valueA
  const lineupScenarioA = context?.teamA && context.rosterPositions
    ? lineupProjectionScenario(context.teamA, sideA, sideB, context.rosterPositions)
    : null
  const lineupScenarioB = context?.teamB && context.rosterPositions
    ? lineupProjectionScenario(context.teamB, sideB, sideA, context.rosterPositions)
    : null
  const lineupImpactA = lineupScenarioA?.expectedDelta ?? null
  const lineupImpactB = lineupScenarioB?.expectedDelta ?? null
  const winner = marketNetA === 0 ? null : marketNetA > 0 ? 'A' : 'B'
  const winnerLabel = winner === 'A'
    ? (context?.teamA?.teamName ?? 'Side A')
    : (context?.teamB?.teamName ?? 'Side B')
  const verdict =
    sideA.length === 0 || sideB.length === 0
      ? 'Build both sides'
      : marketNetA === 0
        ? 'Current market values match'
        : `${winnerLabel} receives ${Math.abs(marketNetA).toLocaleString()} more current market value`

  const sideALow = packageA.lowValue
  const sideAHigh = packageA.highValue
  const sideBLow = packageB.lowValue
  const sideBHigh = packageB.highValue
  const playersInDeal = [...sideA, ...sideB].filter((asset) => asset.kind === 'player')
  const projectionCoverage = playersInDeal.length
    ? Math.round((playersInDeal.filter((asset) => asset.projectedPpg !== undefined).length / playersInDeal.length) * 100)
    : 100

  return {
    valueA,
    valueB,
    marketNetA,
    difference,
    verdict,
    winner,
    projectionCoverage,
    lineupImpactA,
    lineupImpactB,
    lineupScenarioA,
    lineupScenarioB,
    packageA,
    packageB,
    providerNetA: {
      ktc: packageA.providerTotals.ktc === null || packageB.providerTotals.ktc === null
        ? null
        : packageB.providerTotals.ktc - packageA.providerTotals.ktc,
      fantasycalc: packageA.providerTotals.fantasycalc === null || packageB.providerTotals.fantasycalc === null
        ? null
        : packageB.providerTotals.fantasycalc - packageA.providerTotals.fantasycalc,
    },
    pickValueNetA: packageB.pickValue - packageA.pickValue,
    riskNotesA: packageRiskNotes(sideB),
    riskNotesB: packageRiskNotes(sideA),
    projectionNotesA: packageProjectionNotes(sideB),
    projectionNotesB: packageProjectionNotes(sideA),
    rangeA: { worst: sideBLow - sideAHigh, best: sideBHigh - sideALow },
    rangeB: { worst: sideALow - sideBHigh, best: sideAHigh - sideBLow },
  }
}
