import type { LeagueContext } from './league-context'
import type { Asset, PlayerProjection, SleeperPlayer, Team } from './types'

export type WeeklyPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF'

export type WeeklyProjection = {
  playerId: string
  name: string
  position: WeeklyPosition
  team: string | null
  points: number
  rank: number | null
  positionRank: string | null
  ecr: number | null
  expertSd: number | null
  bestRank: number | null
  worstRank: number | null
  opponent: string | null
  tag: string | null
  grade: string | null
}

export type WeeklyGame = {
  team: string
  opponent: string
  home: boolean
  gameday: string
  gametime: string
  kickoffOrder: string
}

export type WeeklyProjectionBundle = {
  season: number
  week: number
  status: 'ready' | 'not-published' | 'partial' | 'unavailable'
  generatedAt: string
  sourceDate: string | null
  source: {
    name: 'DynastyProcess weekly FantasyPros consensus'
    url: string
    pointMethod: 'rank-to-points'
  }
  projections: Record<string, WeeklyProjection>
  games: Record<string, WeeklyGame>
  scheduleComplete: boolean
  coverage: {
    sourceRows: number
    matchedSleeperPlayers: number
    scheduleTeams: number
  }
  warnings: string[]
}

export type WeeklyCandidate = {
  asset: Asset
  points: number | null
  basePoints: number | null
  tepAdjustment: number
  source: 'weekly-consensus' | 'unavailable'
  scoringComplete: boolean
  eligible: boolean
  availability: 'available' | 'questionable' | 'doubtful' | 'out' | 'reserve' | 'taxi' | 'inactive' | 'bye'
  availabilityNote: string | null
  game: WeeklyGame | null
  weekly: WeeklyProjection | null
}

export type WeeklyLineupSlot = {
  slot: string
  slotIndex: number
  candidate: WeeklyCandidate | null
}

export type WeeklyCloseCall = {
  slot: string
  starter: WeeklyCandidate
  alternative: WeeklyCandidate
  projectedDelta: number
}

export type WeeklyLineupRecommendation = {
  slots: WeeklyLineupSlot[]
  starters: WeeklyCandidate[]
  bench: WeeklyCandidate[]
  total: number
  covered: number
  required: number
  complete: boolean
  exactScoringCovered: number
  weeklySourceCount: number
  closeCalls: WeeklyCloseCall[]
}

const SUPPORTED_SLOTS = new Set(['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF'])
const SKILL_POSITIONS = new Set<WeeklyPosition>(['QB', 'RB', 'WR', 'TE'])
const FLEX_POSITIONS = new Set<WeeklyPosition>(['RB', 'WR', 'TE'])

export function normalizeNflTeam(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim().toUpperCase()
  if (!normalized) return null
  if (normalized === 'JAC') return 'JAX'
  return normalized
}

function resolvedPosition(asset: Asset, sleeper: SleeperPlayer | undefined): Asset['position'] {
  const raw = asset.position === 'NA'
    ? sleeper?.position ?? sleeper?.fantasy_positions?.[0] ?? 'NA'
    : asset.position
  return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(raw) ? raw as Asset['position'] : 'NA'
}

/** Adds current Sleeper identity, team, role, and injury fields without changing
 * any market or production values already attached to the team. */
export function hydrateLineupTeam(team: Team, catalog: Map<string, SleeperPlayer>): Team {
  return {
    ...team,
    players: team.players.map((asset) => {
      const sleeper = catalog.get(asset.id)
      const defense = asset.position === 'DEF'
        || sleeper?.position === 'DEF'
        || (!sleeper && /^[A-Z]{2,3}$/.test(asset.id))
      const sleeperName = sleeper?.full_name
        || [sleeper?.first_name, sleeper?.last_name].filter(Boolean).join(' ')
      const name = defense
        ? `${normalizeNflTeam(asset.team ?? asset.id) ?? asset.id} Defense`
        : sleeperName || asset.name
      return {
        ...asset,
        name,
        position: resolvedPosition(asset, sleeper),
        team: normalizeNflTeam(asset.team ?? sleeper?.team ?? (defense ? asset.id : null)),
        active: sleeper?.active ?? asset.active,
        nflStatus: sleeper?.status ?? asset.nflStatus,
        injuryStatus: sleeper?.injury_status ?? asset.injuryStatus,
        depthChartOrder: sleeper?.depth_chart_order ?? asset.depthChartOrder,
        depthChartPosition: sleeper?.depth_chart_position ?? asset.depthChartPosition,
      }
    }),
  }
}

function projectionKey(asset: Asset): string {
  return asset.position === 'DEF'
    ? `DEF:${normalizeNflTeam(asset.team ?? asset.id) ?? asset.id}`
    : asset.id
}

function availability(asset: Asset, game: WeeklyGame | null, scheduleComplete: boolean): Pick<WeeklyCandidate, 'eligible' | 'availability' | 'availabilityNote'> {
  if (asset.isTaxi) return { eligible: false, availability: 'taxi', availabilityNote: 'Taxi-squad players cannot enter the active lineup.' }
  if (asset.isReserve) return { eligible: false, availability: 'reserve', availabilityNote: 'Player is currently in a reserve slot.' }
  if (asset.active === false) return { eligible: false, availability: 'inactive', availabilityNote: 'Sleeper marks this player inactive.' }
  const team = normalizeNflTeam(asset.team)
  if (scheduleComplete && !team) return { eligible: false, availability: 'inactive', availabilityNote: 'Player has no current NFL team.' }

  const status = `${asset.injuryStatus ?? ''} ${asset.nflStatus ?? ''}`.trim()
  if (/\b(out|injured reserve|reserve\/injured|pup|suspended|inactive|non-football injury)\b/i.test(status)) {
    return { eligible: false, availability: 'out', availabilityNote: status || 'Unavailable' }
  }
  if (scheduleComplete && team && !game) {
    return { eligible: false, availability: 'bye', availabilityNote: `${team} has no game in the selected week.` }
  }
  if (/doubt/i.test(status)) return { eligible: true, availability: 'doubtful', availabilityNote: status }
  if (/question|limited/i.test(status)) return { eligible: true, availability: 'questionable', availabilityNote: status }
  return { eligible: true, availability: 'available', availabilityNote: status || null }
}

function leagueTepAdjustment(asset: Asset, projection: PlayerProjection | undefined, context: LeagueContext): number | null {
  if (asset.position !== 'TE' || context.scoring.tePremiumPerReception === 0) return 0
  if (!Number.isFinite(projection?.receptionsPerTeamWeek)) return null
  return Number((Number(projection!.receptionsPerTeamWeek) * context.scoring.tePremiumPerReception).toFixed(2))
}

export function buildWeeklyCandidates(
  team: Team,
  bundle: WeeklyProjectionBundle,
  projections: Map<string, PlayerProjection>,
  context: LeagueContext,
): WeeklyCandidate[] {
  return team.players
    .filter((asset) => asset.kind === 'player' && ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(asset.position))
    .map((asset) => {
      const teamCode = normalizeNflTeam(asset.team)
      const game = teamCode ? bundle.games[teamCode] ?? null : null
      const weekly = bundle.status === 'ready' || bundle.status === 'partial'
        ? bundle.projections[projectionKey(asset)] ?? null
        : null
      const productionProjection = projections.get(asset.id)
      const adjustment = weekly ? leagueTepAdjustment(asset, productionProjection, context) : 0
      // A season-transition forecast answers a different question from a
      // conditional weekly start/sit projection. Never let it compete with the
      // current-week consensus inside the optimizer.
      const basePoints = weekly ? weekly.points : null
      const points = basePoints === null ? null : Number((basePoints + (adjustment ?? 0)).toFixed(2))
      const source: WeeklyCandidate['source'] = weekly
        ? 'weekly-consensus'
        : 'unavailable'
      const standardQuarterbackScoring = context.scoring.passingTd === 4
        && context.scoring.passingInterception === -2
      const exactPositionScoring = asset.position !== 'K'
        && asset.position !== 'DEF'
        && (asset.position !== 'QB' || standardQuarterbackScoring)
      const scoringComplete = exactPositionScoring && Boolean(weekly) && adjustment !== null
      return {
        asset,
        points,
        basePoints,
        tepAdjustment: adjustment ?? 0,
        source,
        scoringComplete,
        game,
        weekly,
        ...availability(asset, game, bundle.scheduleComplete),
      }
    })
    .sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity) || a.asset.id.localeCompare(b.asset.id))
}

export function eligibleForSlot(position: Asset['position'], slot: string): boolean {
  if (slot === 'FLEX') return FLEX_POSITIONS.has(position as WeeklyPosition)
  if (slot === 'SUPER_FLEX') return SKILL_POSITIONS.has(position as WeeklyPosition)
  return position === slot
}

function usable(candidates: WeeklyCandidate[]): WeeklyCandidate[] {
  return candidates.filter((candidate) => candidate.eligible && candidate.points !== null)
}

function takeBest(pool: WeeklyCandidate[], slot: string): WeeklyCandidate | null {
  const candidate = pool.find((item) => eligibleForSlot(item.asset.position, slot)) ?? null
  if (candidate) pool.splice(pool.indexOf(candidate), 1)
  return candidate
}

function kickoff(candidate: WeeklyCandidate): string {
  return candidate.game?.kickoffOrder ?? '9999-99-99T99:99'
}

function arrangeLateSwap(selected: WeeklyCandidate[], rosterPositions: string[]): WeeklyLineupSlot[] {
  const remaining = [...selected]
  const slots = rosterPositions
    .map((slot, slotIndex) => ({ slot, slotIndex }))
    .filter(({ slot }) => SUPPORTED_SLOTS.has(slot))
  const assignments = new Map<number, WeeklyCandidate>()

  const exactSlots = slots.filter(({ slot }) => slot !== 'FLEX' && slot !== 'SUPER_FLEX')
  exactSlots.forEach(({ slotIndex, slot }) => {
    const eligible = remaining
      .filter((candidate) => candidate.asset.position === slot)
      .sort((a, b) => kickoff(a).localeCompare(kickoff(b)) || (b.points ?? 0) - (a.points ?? 0))
    const candidate = eligible[0]
    if (!candidate) return
    assignments.set(slotIndex, candidate)
    remaining.splice(remaining.indexOf(candidate), 1)
  })

  const flexSlots = slots.filter(({ slot }) => slot === 'FLEX')
  flexSlots.forEach(({ slotIndex }) => {
    const eligible = remaining
      .filter((candidate) => eligibleForSlot(candidate.asset.position, 'FLEX'))
      .sort((a, b) => kickoff(a).localeCompare(kickoff(b)) || (b.points ?? 0) - (a.points ?? 0))
    const candidate = eligible[0]
    if (!candidate) return
    assignments.set(slotIndex, candidate)
    remaining.splice(remaining.indexOf(candidate), 1)
  })

  const superFlexSlots = slots.filter(({ slot }) => slot === 'SUPER_FLEX')
  superFlexSlots.forEach(({ slotIndex }) => {
    const eligible = remaining
      .filter((candidate) => eligibleForSlot(candidate.asset.position, 'SUPER_FLEX'))
      .sort((a, b) => kickoff(b).localeCompare(kickoff(a)) || (b.points ?? 0) - (a.points ?? 0))
    const candidate = eligible[0]
    if (!candidate) return
    assignments.set(slotIndex, candidate)
    remaining.splice(remaining.indexOf(candidate), 1)
  })

  return slots.map(({ slot, slotIndex }) => ({ slot, slotIndex, candidate: assignments.get(slotIndex) ?? null }))
}

export function optimizeWeeklyLineup(candidates: WeeklyCandidate[], rosterPositions: string[]): WeeklyLineupRecommendation {
  const pool = usable(candidates)
  const exact = rosterPositions.filter((slot) => SUPPORTED_SLOTS.has(slot) && slot !== 'FLEX' && slot !== 'SUPER_FLEX')
  const flex = rosterPositions.filter((slot) => slot === 'FLEX')
  const superFlex = rosterPositions.filter((slot) => slot === 'SUPER_FLEX')
  const selected = [...exact, ...flex, ...superFlex].flatMap((slot) => {
    const candidate = takeBest(pool, slot)
    return candidate ? [candidate] : []
  })
  const slots = arrangeLateSwap(selected, rosterPositions)
  const starters = slots.flatMap((slot) => slot.candidate ? [slot.candidate] : [])
  const starterIds = new Set(starters.map((candidate) => candidate.asset.id))
  const bench = candidates.filter((candidate) => !starterIds.has(candidate.asset.id))
  const closeCalls = slots.flatMap((slot) => {
    if (!slot.candidate) return []
    const alternative = bench
      .filter((candidate) => candidate.eligible && candidate.points !== null && eligibleForSlot(candidate.asset.position, slot.slot))
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || a.asset.id.localeCompare(b.asset.id))[0]
    if (!alternative) return []
    return [{
      slot: slot.slot,
      starter: slot.candidate,
      alternative,
      projectedDelta: Number(((slot.candidate.points ?? 0) - (alternative.points ?? 0)).toFixed(2)),
    }]
  }).sort((a, b) => a.projectedDelta - b.projectedDelta).slice(0, 4)
  const required = slots.length
  const covered = starters.length
  return {
    slots,
    starters,
    bench,
    total: Number(starters.reduce((sum, candidate) => sum + (candidate.points ?? 0), 0).toFixed(2)),
    covered,
    required,
    complete: covered === required,
    exactScoringCovered: starters.filter((candidate) => candidate.scoringComplete).length,
    weeklySourceCount: starters.filter((candidate) => candidate.source === 'weekly-consensus').length,
    closeCalls,
  }
}

export function submittedLineupDelta(
  starterIds: string[],
  recommendation: WeeklyLineupRecommendation,
  candidates: WeeklyCandidate[],
): { incoming: WeeklyCandidate[]; outgoing: WeeklyCandidate[]; projectedDelta: number | null } {
  const currentIds = new Set(starterIds.filter((id) => id && id !== '0'))
  const submitted = candidates.filter((candidate) => currentIds.has(candidate.asset.id))
  const submittedComplete = submitted.length === recommendation.required
    && submitted.every((candidate) => candidate.points !== null)
  if (!recommendation.complete || !submittedComplete) {
    return { incoming: [], outgoing: [], projectedDelta: null }
  }
  const recommendedIds = new Set(recommendation.starters.map((candidate) => candidate.asset.id))
  const incoming = recommendation.starters.filter((candidate) => !currentIds.has(candidate.asset.id))
  const outgoing = candidates.filter((candidate) => currentIds.has(candidate.asset.id) && !recommendedIds.has(candidate.asset.id))
  const submittedTotal = submitted.reduce((sum, candidate) => sum + (candidate.points ?? 0), 0)
  return {
    incoming,
    outgoing,
    projectedDelta: Number((recommendation.total - submittedTotal).toFixed(2)),
  }
}
