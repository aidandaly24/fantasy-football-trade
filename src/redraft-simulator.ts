import type { LeagueBundle, RedraftDraftPool, RedraftDraftProjection } from './types'

export type DraftablePosition = 'QB' | 'RB' | 'WR' | 'TE'

export type MockDraftPlayer = {
  playerId: string
  name: string
  position: DraftablePosition
  team: string | null
  injuryStatus: string | null
  adp: number
  projectedPoints: number
}

export type RedraftRanking = MockDraftPlayer & {
  overallRank: number
  positionRank: number
}

export type MockCandidate = {
  player: MockDraftPlayer
  availableAtPickProbability: number
  survivesNextTurnProbability: number
  expectedStarterPoints: number
  expectedRosterScore: number
  conditionalSimulations: number
}

export type MockRoundPlan = {
  round: number
  overallPick: number
  topSelections: Array<{ player: MockDraftPlayer; probability: number }>
  positionMix: Array<{ position: DraftablePosition; probability: number }>
}

export type MockBuild = {
  firstPick: MockDraftPlayer
  frequency: number
  starterPoints: number
  rosterScore: number
  picks: Array<{ overallPick: number; player: MockDraftPlayer }>
}

export type MockDraftResult = {
  version: 'snake-monte-carlo-v1'
  simulations: number
  scenarioSimulations: number
  currentOverallPick: number | null
  nextUserOverallPick: number | null
  followingUserOverallPick: number | null
  complete: boolean
  candidates: MockCandidate[]
  roundPlans: MockRoundPlan[]
  builds: MockBuild[]
  boundary: string[]
}

type Slots = { QB: number; RB: number; WR: number; TE: number; FLEX: number }
type Baselines = { QB: number; RB: number; WR: number; TE: number; FLEX: number }
type PickedPlayer = { overallPick: number; player: MockDraftPlayer }
type SimulationResult = {
  firstAvailability: Set<string>
  secondAvailability: Set<string>
  userPicks: PickedPlayer[]
  userRoster: MockDraftPlayer[]
  starterPoints: number
  rosterScore: number
}

const POSITIONS: DraftablePosition[] = ['QB', 'RB', 'WR', 'TE']

function finite(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function leagueProjectedPoints(player: RedraftDraftProjection, scoring: Record<string, number>): number {
  const stats = player.stats
  const points = stats.passYd * finite(scoring.pass_yd)
    + stats.passTd * finite(scoring.pass_td)
    + stats.passInt * finite(scoring.pass_int)
    + stats.pass2pt * finite(scoring.pass_2pt)
    + stats.rushYd * finite(scoring.rush_yd)
    + stats.rushTd * finite(scoring.rush_td)
    + stats.rush2pt * finite(scoring.rush_2pt)
    + stats.rec * finite(scoring.rec)
    + stats.recYd * finite(scoring.rec_yd)
    + stats.recTd * finite(scoring.rec_td)
    + stats.rec2pt * finite(scoring.rec_2pt)
    + stats.fumLost * finite(scoring.fum_lost)
    + (player.position === 'TE' ? stats.rec * finite(scoring.bonus_rec_te) : 0)
  if (points > 0) return Number(points.toFixed(1))
  return Number((stats.ptsPpr ?? 0).toFixed(1))
}

export function draftPlayersForLeague(pool: RedraftDraftPool, bundle: LeagueBundle): MockDraftPlayer[] {
  return pool.players.map((player) => ({
    playerId: player.playerId,
    name: player.name,
    position: player.position,
    team: player.team,
    injuryStatus: player.injuryStatus,
    adp: player.stats.adpPpr,
    projectedPoints: leagueProjectedPoints(player, bundle.league.scoring_settings),
  })).sort((left, right) => left.adp - right.adp || right.projectedPoints - left.projectedPoints)
}

export function availableRedraftRankings(pool: RedraftDraftPool, bundle: LeagueBundle): RedraftRanking[] {
  const unavailable = new Set([
    ...bundle.draftPicks.map((pick) => pick.player_id),
    ...bundle.rosters.flatMap((roster) => roster.keepers ?? []),
  ])
  const positionRanks = new Map<DraftablePosition, number>()
  return draftPlayersForLeague(pool, bundle)
    .map((player, index): RedraftRanking => {
      const positionRank = (positionRanks.get(player.position) ?? 0) + 1
      positionRanks.set(player.position, positionRank)
      return { ...player, overallRank: index + 1, positionRank }
    })
    .filter((player) => !unavailable.has(player.playerId))
}

function rosterSlots(bundle: LeagueBundle): Slots {
  const count = (position: string) => bundle.league.roster_positions.filter((slot) => slot === position).length
  return { QB: count('QB'), RB: count('RB'), WR: count('WR'), TE: count('TE'), FLEX: count('FLEX') }
}

function replacementBaselines(players: MockDraftPlayer[], slots: Slots, teamCount: number): Baselines {
  const baseline = (position: DraftablePosition, demand: number) => {
    const values = players.filter((player) => player.position === position).map((player) => player.projectedPoints).sort((a, b) => b - a)
    return values[Math.min(values.length - 1, Math.max(0, demand))] ?? 0
  }
  const flexDemand = (slots.RB + slots.WR + slots.TE + slots.FLEX) * teamCount
  const flexValues = players.filter((player) => player.position !== 'QB').map((player) => player.projectedPoints).sort((a, b) => b - a)
  return {
    QB: baseline('QB', slots.QB * teamCount),
    RB: baseline('RB', slots.RB * teamCount),
    WR: baseline('WR', slots.WR * teamCount),
    TE: baseline('TE', slots.TE * teamCount),
    FLEX: flexValues[Math.min(flexValues.length - 1, Math.max(0, flexDemand))] ?? 0,
  }
}

function allocateLineup(roster: MockDraftPlayer[], slots: Slots, baselines?: Baselines): { points: number; starters: Set<string> } {
  const starters = new Set<string>()
  let points = 0
  for (const position of POSITIONS) {
    const count = slots[position]
    const options = roster.filter((player) => player.position === position).sort((a, b) => b.projectedPoints - a.projectedPoints)
    options.slice(0, count).forEach((player) => {
      starters.add(player.playerId)
      points += player.projectedPoints
    })
    if (baselines && options.length < count) points += (count - options.length) * baselines[position]
  }
  const flex = roster
    .filter((player) => player.position !== 'QB' && !starters.has(player.playerId))
    .sort((a, b) => b.projectedPoints - a.projectedPoints)
  flex.slice(0, slots.FLEX).forEach((player) => {
    starters.add(player.playerId)
    points += player.projectedPoints
  })
  if (baselines && flex.length < slots.FLEX) points += (slots.FLEX - flex.length) * baselines.FLEX
  return { points, starters }
}

function partialRosterScore(roster: MockDraftPlayer[], slots: Slots, baselines: Baselines): number {
  const lineup = allocateLineup(roster, slots, baselines)
  const bench = roster.filter((player) => !lineup.starters.has(player.playerId))
  return lineup.points + bench.reduce((total, player) => total + player.projectedPoints * 0.06, 0)
}

function finalRosterScore(roster: MockDraftPlayer[], slots: Slots): { starterPoints: number; rosterScore: number } {
  const lineup = allocateLineup(roster, slots)
  const bench = roster.filter((player) => !lineup.starters.has(player.playerId))
  return {
    starterPoints: Number(lineup.points.toFixed(1)),
    rosterScore: Number((lineup.points + bench.reduce((total, player) => total + player.projectedPoints * 0.06, 0)).toFixed(1)),
  }
}

function hashSeed(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function normal(next: () => number): number {
  const left = Math.max(next(), Number.EPSILON)
  const right = Math.max(next(), Number.EPSILON)
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right)
}

function rosterIdBySlot(bundle: LeagueBundle): Map<number, number> {
  const direct = new Map(Object.entries(bundle.draft?.slot_to_roster_id ?? {}).map(([slot, rosterId]) => [Number(slot), Number(rosterId)]))
  if (direct.size > 0) return direct
  const byOwner = new Map(bundle.rosters.map((roster) => [roster.owner_id, roster.roster_id]))
  return new Map(Object.entries(bundle.draft?.draft_order ?? {}).flatMap(([ownerId, slot]) => {
    const rosterId = byOwner.get(ownerId)
    return rosterId ? [[Number(slot), rosterId] as const] : []
  }))
}

export function draftSlotAtOverallPick(overallPick: number, teamCount: number): number {
  const round = Math.floor((overallPick - 1) / teamCount) + 1
  const positionInRound = ((overallPick - 1) % teamCount) + 1
  return round % 2 === 1 ? positionInRound : teamCount - positionInRound + 1
}

export function draftPickLabel(overallPick: number, teamCount: number): string {
  const round = Math.floor((overallPick - 1) / teamCount) + 1
  const pickInRound = ((overallPick - 1) % teamCount) + 1
  return `${round}.${String(pickInRound).padStart(2, '0')}`
}

function countPosition(roster: MockDraftPlayer[], position: DraftablePosition): number {
  return roster.filter((player) => player.position === position).length
}

function positionPenalty(roster: MockDraftPlayer[], player: MockDraftPlayer, round: number): number {
  const count = countPosition(roster, player.position)
  if (player.position === 'QB') {
    if (count >= 2) return 500
    if (count >= 1 && round < 10) return 65
    if (count === 0 && round >= 10) return -50
  }
  if (player.position === 'TE') {
    if (count >= 2) return 300
    if (count >= 1 && round < 10) return 52
    if (count === 0 && round >= 10) return -44
  }
  if ((player.position === 'RB' || player.position === 'WR') && count < 2) return -4
  return 0
}

function userRosterAdjustment(roster: MockDraftPlayer[], player: MockDraftPlayer, round: number, slots: Slots): number {
  const count = countPosition(roster, player.position)
  const fixedNeed = slots[player.position]
  if (count < fixedNeed) return 72

  if (player.position === 'QB' || player.position === 'TE') {
    if (count >= 2) return -700
    return round < 11 ? -400 : -70
  }

  const flexEligible = roster.filter((candidate) => candidate.position !== 'QB').length
  const flexCore = slots.RB + slots.WR + slots.TE + slots.FLEX
  if (flexEligible < flexCore) return 18
  return 0
}

function chooseOpponent(
  available: Set<string>,
  players: MockDraftPlayer[],
  roster: MockDraftPlayer[],
  latentAdp: Map<string, number>,
  round: number,
  forbidden?: string,
): MockDraftPlayer {
  let best: MockDraftPlayer | undefined
  let bestScore = Number.POSITIVE_INFINITY
  players.forEach((player) => {
    if (!available.has(player.playerId) || player.playerId === forbidden) return
    const score = (latentAdp.get(player.playerId) ?? player.adp) + positionPenalty(roster, player, round)
    if (score < bestScore) {
      best = player
      bestScore = score
    }
  })
  return best ?? players.find((player) => available.has(player.playerId) && player.playerId !== forbidden)!
}

function userPriority(
  player: MockDraftPlayer,
  roster: MockDraftPlayer[],
  overallPick: number,
  nextUserPick: number | null,
  teamCount: number,
  slots: Slots,
  baselines: Baselines,
): number {
  const before = partialRosterScore(roster, slots, baselines)
  const marginal = partialRosterScore([...roster, player], slots, baselines) - before
  const round = Math.floor((overallPick - 1) / teamCount) + 1
  const need = userRosterAdjustment(roster, player, round, slots)
  const gap = nextUserPick ? Math.max(1, nextUserPick - overallPick) : 10
  const urgency = nextUserPick ? Math.max(0, Math.min(1, (nextUserPick - player.adp) / gap)) * 8 : 0
  const marketValue = Math.max(-8, Math.min(8, (overallPick - player.adp) * 0.35))
  return marginal + need + urgency + marketValue
}

function chooseUser(
  available: Set<string>,
  players: MockDraftPlayer[],
  roster: MockDraftPlayer[],
  overallPick: number,
  nextUserPick: number | null,
  teamCount: number,
  slots: Slots,
  baselines: Baselines,
  forbidden?: string,
): MockDraftPlayer {
  const flexEligible = roster.filter((player) => player.position !== 'QB').length
  const startingCoreComplete = countPosition(roster, 'QB') >= slots.QB
    && countPosition(roster, 'RB') >= slots.RB
    && countPosition(roster, 'WR') >= slots.WR
    && countPosition(roster, 'TE') >= slots.TE
    && flexEligible >= slots.RB + slots.WR + slots.TE + slots.FLEX
  const market = players.filter((player) => {
    if (!available.has(player.playerId) || player.playerId === forbidden) return false
    if (player.position !== 'QB' && player.position !== 'TE') return true
    const count = countPosition(roster, player.position)
    if (count >= 2) return false
    return count === 0 || startingCoreComplete
  })
  const shortlist = market.filter((player) => player.adp <= overallPick + 18).slice(0, 32)
  const candidates = shortlist.length >= 6 ? shortlist : market.slice(0, 12)
  return candidates.sort((left, right) =>
    userPriority(right, roster, overallPick, nextUserPick, teamCount, slots, baselines)
      - userPriority(left, roster, overallPick, nextUserPick, teamCount, slots, baselines)
      || left.adp - right.adp)[0]
}

function futureUserPicks(bundle: LeagueBundle, myRosterId: number, currentOverallPick: number): number[] {
  const teams = Number(bundle.draft?.settings?.teams ?? bundle.league.total_rosters)
  const rounds = Number(bundle.draft?.settings?.rounds ?? bundle.league.roster_positions.length)
  const rosterBySlot = rosterIdBySlot(bundle)
  const recorded = new Set(bundle.draftPicks.map((pick) => pick.pick_no))
  return Array.from({ length: teams * rounds }, (_, index) => index + 1)
    .filter((pick) => pick >= currentOverallPick && !recorded.has(pick) && rosterBySlot.get(draftSlotAtOverallPick(pick, teams)) === myRosterId)
}

function firstOpenPick(bundle: LeagueBundle): number | null {
  const teams = Number(bundle.draft?.settings?.teams ?? bundle.league.total_rosters)
  const rounds = Number(bundle.draft?.settings?.rounds ?? bundle.league.roster_positions.length)
  const recorded = new Set(bundle.draftPicks.map((pick) => pick.pick_no))
  return Array.from({ length: teams * rounds }, (_, index) => index + 1).find((pick) => !recorded.has(pick)) ?? null
}

function simulate(
  bundle: LeagueBundle,
  players: MockDraftPlayer[],
  myRosterId: number,
  slots: Slots,
  baselines: Baselines,
  seed: number,
  options: { forceAtFirstUser?: string; forbidAtFirstUser?: string; stopBeforeSecondUser?: boolean } = {},
): SimulationResult {
  const teams = Number(bundle.draft?.settings?.teams ?? bundle.league.total_rosters)
  const rounds = Number(bundle.draft?.settings?.rounds ?? bundle.league.roster_positions.length)
  const totalPicks = teams * rounds
  const byId = new Map(players.map((player) => [player.playerId, player]))
  const rosters = new Map(bundle.rosters.map((roster) => [roster.roster_id, [] as MockDraftPlayer[]]))
  const userPicks: PickedPlayer[] = []
  const knownPicks = new Map(bundle.draftPicks.map((pick) => [pick.pick_no, pick]))
  const unavailable = new Set<string>()
  bundle.rosters.forEach((roster) => (roster.keepers ?? []).forEach((playerId) => {
    const player = byId.get(playerId)
    if (player && !unavailable.has(playerId)) rosters.get(roster.roster_id)?.push(player)
    unavailable.add(playerId)
  }))
  bundle.draftPicks.forEach((pick) => {
    const player = byId.get(pick.player_id)
    if (player && !unavailable.has(pick.player_id)) rosters.get(pick.roster_id)?.push(player)
    if (player && pick.roster_id === myRosterId) userPicks.push({ overallPick: pick.pick_no, player })
    unavailable.add(pick.player_id)
  })
  const available = new Set(players.filter((player) => !unavailable.has(player.playerId)).map((player) => player.playerId))
  const nextRandom = random(seed)
  const latentAdp = new Map(players.map((player) => {
    const spread = Math.min(14, Math.max(1.8, 1.4 + player.adp * 0.1))
    return [player.playerId, Math.max(0.1, player.adp + normal(nextRandom) * spread)]
  }))
  const rosterBySlot = rosterIdBySlot(bundle)
  const currentPick = firstOpenPick(bundle)
  if (currentPick === null) {
    const roster = rosters.get(myRosterId) ?? []
    const score = finalRosterScore(roster, slots)
    return { firstAvailability: new Set(), secondAvailability: new Set(), userPicks, userRoster: roster, ...score }
  }
  const userTurns = futureUserPicks(bundle, myRosterId, currentPick)
  let futureUserPickIndex = 0
  let firstAvailability = new Set<string>()
  let secondAvailability = new Set<string>()

  for (let overallPick = currentPick; overallPick <= totalPicks; overallPick += 1) {
    if (knownPicks.has(overallPick)) continue
    const round = Math.floor((overallPick - 1) / teams) + 1
    const rosterId = rosterBySlot.get(draftSlotAtOverallPick(overallPick, teams))
    if (!rosterId) continue
    const roster = rosters.get(rosterId) ?? []
    let selected: MockDraftPlayer
    if (rosterId === myRosterId) {
      if (futureUserPickIndex === 0) firstAvailability = new Set(available)
      if (futureUserPickIndex === 1) {
        secondAvailability = new Set(available)
        if (options.stopBeforeSecondUser) break
      }
      const nextUserPick = userTurns[futureUserPickIndex + 1] ?? null
      if (futureUserPickIndex === 0 && options.forceAtFirstUser && available.has(options.forceAtFirstUser)) {
        selected = byId.get(options.forceAtFirstUser)!
      } else {
        selected = chooseUser(available, players, roster, overallPick, nextUserPick, teams, slots, baselines,
          futureUserPickIndex === 0 ? options.forbidAtFirstUser : undefined)
      }
      userPicks.push({ overallPick, player: selected })
      futureUserPickIndex += 1
    } else {
      selected = chooseOpponent(
        available,
        players,
        roster,
        latentAdp,
        round,
        futureUserPickIndex === 0 ? options.forceAtFirstUser : undefined,
      )
    }
    available.delete(selected.playerId)
    roster.push(selected)
    rosters.set(rosterId, roster)
  }

  const userRoster = rosters.get(myRosterId) ?? []
  const score = finalRosterScore(userRoster, slots)
  return { firstAvailability, secondAvailability, userPicks, userRoster, ...score }
}

function topCandidates(
  players: MockDraftPlayer[],
  availability: Map<string, number>,
  simulations: number,
  roster: MockDraftPlayer[],
  overallPick: number,
  nextUserPick: number | null,
  teamCount: number,
  slots: Slots,
  baselines: Baselines,
): MockDraftPlayer[] {
  return players
    .filter((player) => (availability.get(player.playerId) ?? 0) / simulations >= 0.03)
    .sort((left, right) =>
      userPriority(right, roster, overallPick, nextUserPick, teamCount, slots, baselines)
        - userPriority(left, roster, overallPick, nextUserPick, teamCount, slots, baselines)
        || left.adp - right.adp)
    .slice(0, 8)
}

function existingUserRoster(bundle: LeagueBundle, players: MockDraftPlayer[], myRosterId: number): MockDraftPlayer[] {
  const byId = new Map(players.map((player) => [player.playerId, player]))
  const roster = bundle.rosters.find((candidate) => candidate.roster_id === myRosterId)
  const ids = [
    ...(roster?.keepers ?? []),
    ...bundle.draftPicks.filter((pick) => pick.roster_id === myRosterId).map((pick) => pick.player_id),
  ]
  return [...new Set(ids)].flatMap((id) => byId.get(id) ? [byId.get(id)!] : [])
}

export function runRedraftMockDrafts(
  bundle: LeagueBundle,
  pool: RedraftDraftPool,
  myRosterId: number,
  config: { simulations?: number; scenarioSimulations?: number } = {},
): MockDraftResult {
  const simulations = config.simulations ?? 240
  const scenarioSimulations = config.scenarioSimulations ?? 120
  const players = draftPlayersForLeague(pool, bundle)
  const teamCount = Number(bundle.draft?.settings?.teams ?? bundle.league.total_rosters)
  const slots = rosterSlots(bundle)
  const baselines = replacementBaselines(players, slots, teamCount)
  const currentOverallPick = firstOpenPick(bundle)
  if (currentOverallPick === null) {
    return {
      version: 'snake-monte-carlo-v1', simulations, scenarioSimulations, currentOverallPick: null,
      nextUserOverallPick: null, followingUserOverallPick: null, complete: true,
      candidates: [], roundPlans: [], builds: [],
      boundary: ['The Sleeper draft is complete; live roster evaluation should replace pre-draft simulation.'],
    }
  }
  const userTurns = futureUserPicks(bundle, myRosterId, currentOverallPick)
  const nextUserOverallPick = userTurns[0] ?? null
  const followingUserOverallPick = userTurns[1] ?? null
  if (nextUserOverallPick === null) {
    return {
      version: 'snake-monte-carlo-v1', simulations, scenarioSimulations, currentOverallPick,
      nextUserOverallPick: null, followingUserOverallPick: null, complete: false,
      candidates: [], roundPlans: [], builds: [],
      boundary: ['No remaining pick could be mapped to the selected roster.'],
    }
  }
  const stateKey = `${bundle.league.league_id}:${bundle.draftPicks.map((pick) => `${pick.pick_no}-${pick.player_id}`).join('|')}`
  const baseSeed = hashSeed(stateKey)
  const availability = new Map<string, number>()
  const roundSelections = new Map<number, Map<string, number>>()
  const baseResults: SimulationResult[] = []
  for (let run = 0; run < simulations; run += 1) {
    const result = simulate(bundle, players, myRosterId, slots, baselines, baseSeed + run * 7919)
    result.firstAvailability.forEach((id) => availability.set(id, (availability.get(id) ?? 0) + 1))
    result.userPicks.filter((pick) => pick.overallPick >= nextUserOverallPick).forEach((pick) => {
      const selections = roundSelections.get(pick.overallPick) ?? new Map<string, number>()
      selections.set(pick.player.playerId, (selections.get(pick.player.playerId) ?? 0) + 1)
      roundSelections.set(pick.overallPick, selections)
    })
    baseResults.push(result)
  }

  const currentRoster = existingUserRoster(bundle, players, myRosterId)
  const candidatePlayers = topCandidates(players, availability, simulations, currentRoster, nextUserOverallPick, followingUserOverallPick, teamCount, slots, baselines)
  const candidates = candidatePlayers.map((candidate): MockCandidate => {
    let forced = 0
    let starterPoints = 0
    let rosterScore = 0
    let passed = 0
    let survived = 0
    for (let run = 0; run < scenarioSimulations; run += 1) {
      const seed = baseSeed + run * 104729
      const forcedResult = simulate(bundle, players, myRosterId, slots, baselines, seed, { forceAtFirstUser: candidate.playerId })
      if (forcedResult.userPicks.find((pick) => pick.overallPick === nextUserOverallPick)?.player.playerId === candidate.playerId) {
        forced += 1
        starterPoints += forcedResult.starterPoints
        rosterScore += forcedResult.rosterScore
      }
      const passResult = simulate(bundle, players, myRosterId, slots, baselines, seed, {
        forbidAtFirstUser: candidate.playerId,
        stopBeforeSecondUser: true,
      })
      if (passResult.firstAvailability.has(candidate.playerId)) {
        passed += 1
        if (passResult.secondAvailability.has(candidate.playerId)) survived += 1
      }
    }
    return {
      player: candidate,
      availableAtPickProbability: (availability.get(candidate.playerId) ?? 0) / simulations,
      survivesNextTurnProbability: passed > 0 ? survived / passed : 0,
      expectedStarterPoints: forced > 0 ? starterPoints / forced : 0,
      expectedRosterScore: forced > 0 ? rosterScore / forced : 0,
      conditionalSimulations: forced,
    }
  }).filter((candidate) => candidate.conditionalSimulations > 0)
    .sort((left, right) =>
      (right.expectedRosterScore - right.survivesNextTurnProbability * 80)
        - (left.expectedRosterScore - left.survivesNextTurnProbability * 80)
      || left.player.adp - right.player.adp)

  const byId = new Map(players.map((player) => [player.playerId, player]))
  const roundPlans: MockRoundPlan[] = [...roundSelections.entries()].sort((a, b) => a[0] - b[0]).map(([overallPick, selections]) => {
    const total = [...selections.values()].reduce((sum, count) => sum + count, 0)
    const topSelections = [...selections.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .flatMap(([id, count]) => byId.get(id) ? [{ player: byId.get(id)!, probability: count / total }] : [])
    const positionCounts = new Map<DraftablePosition, number>()
    selections.forEach((count, id) => {
      const position = byId.get(id)?.position
      if (position) positionCounts.set(position, (positionCounts.get(position) ?? 0) + count)
    })
    return {
      round: Math.floor((overallPick - 1) / teamCount) + 1,
      overallPick,
      topSelections,
      positionMix: [...positionCounts.entries()].map(([position, count]) => ({ position, probability: count / total })).sort((a, b) => b.probability - a.probability),
    }
  })

  const buildGroups = new Map<string, SimulationResult[]>()
  baseResults.forEach((result) => {
    const first = result.userPicks.find((pick) => pick.overallPick === nextUserOverallPick)
    if (!first) return
    const group = buildGroups.get(first.player.playerId) ?? []
    group.push(result)
    buildGroups.set(first.player.playerId, group)
  })
  const builds = [...buildGroups.entries()].map(([playerId, results]): MockBuild | null => {
    const ordered = [...results].sort((left, right) => left.rosterScore - right.rosterScore)
    const representative = ordered[Math.floor(ordered.length / 2)]
    const firstPick = byId.get(playerId)
    if (!firstPick) return null
    return {
      firstPick,
      frequency: results.length / simulations,
      starterPoints: representative.starterPoints,
      rosterScore: representative.rosterScore,
      picks: representative.userPicks.filter((pick) => pick.overallPick >= nextUserOverallPick),
    }
  }).filter((build): build is MockBuild => Boolean(build))
    .sort((left, right) => right.frequency - left.frequency)
    .slice(0, 3)

  return {
    version: 'snake-monte-carlo-v1',
    simulations,
    scenarioSimulations,
    currentOverallPick,
    nextUserOverallPick,
    followingUserOverallPick,
    complete: false,
    candidates,
    roundPlans,
    builds,
    boundary: [
      'Opponent selections vary around current Sleeper PPR ADP and react only to broad roster needs; this league has no manager-specific draft history.',
      'Projected points use the league scoring settings and the Sleeper-hosted season projection feed; they are forecasts, not guarantees.',
      'Each candidate build is a conditional what-if path where that player reaches your turn; availability percentages come from the unforced room paths.',
      'Candidate ordering compares completed simulated lineups. It is not a trained championship or win-probability model.',
    ],
  }
}
