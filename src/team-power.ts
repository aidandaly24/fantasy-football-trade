import type { Asset, Team } from './types'

const SKILL_POSITIONS = new Set<Asset['position']>(['QB', 'RB', 'WR', 'TE'])

export type LineupPower = {
  score: number
  starters: Asset[]
  covered: number
  required: number
  coveragePercent: number
  complete: boolean
  positionTotals: Record<'QB' | 'RB' | 'WR' | 'TE', number>
}

export type TeamPowerRow = LineupPower & {
  team: Team
  rank: number
  gapToTarget: number
  targetRank: number
  targetScore: number
}

export type CurrentSeasonPowerScenario = {
  before: LineupPower
  after: LineupPower
  delta: number | null
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
    .sort((a, b) => scoreAsset(b) - scoreAsset(a) || b.value - a.value || a.id.localeCompare(b.id))[0]
  if (!eligible) return undefined
  pool.splice(pool.findIndex((asset) => asset.id === eligible.id), 1)
  return eligible
}

/** Fills the league's legal skill lineup using one explicit value function. */
export function optimizeLineupBy(
  players: Asset[],
  rosterPositions: string[],
  scoreAsset: (asset: Asset) => number,
): Asset[] {
  const pool = players.filter((player) => SKILL_POSITIONS.has(player.position))
  const selected: Asset[] = []
  const required = rosterPositions.filter((position) => SKILL_POSITIONS.has(position as Asset['position']))
  const flex = rosterPositions.filter((position) => position === 'FLEX')
  const superFlex = rosterPositions.filter((position) => position === 'SUPER_FLEX')

  ;[...required, ...flex, ...superFlex].forEach((position) => {
    const best = takeBest(pool, position, scoreAsset)
    if (best) selected.push(best)
  })
  return selected
}

export function currentSeasonValue(asset: Asset): number {
  return asset.kind === 'player' && Number.isFinite(asset.currentSeasonValue)
    ? Number(asset.currentSeasonValue)
    : 0
}

export function currentSeasonLineup(players: Asset[], rosterPositions: string[]): LineupPower {
  const starters = optimizeLineupBy(players, rosterPositions, currentSeasonValue)
  const required = rosterPositions.filter((position) => (
    SKILL_POSITIONS.has(position as Asset['position']) || position === 'FLEX' || position === 'SUPER_FLEX'
  )).length
  const covered = starters.filter((asset) => asset.currentSeasonValue !== undefined).length
  const positionTotals: LineupPower['positionTotals'] = { QB: 0, RB: 0, WR: 0, TE: 0 }
  starters.forEach((asset) => {
    if (asset.position === 'QB' || asset.position === 'RB' || asset.position === 'WR' || asset.position === 'TE') {
      positionTotals[asset.position] += currentSeasonValue(asset)
    }
  })
  return {
    score: Math.round(starters.reduce((sum, asset) => sum + currentSeasonValue(asset), 0)),
    starters,
    covered,
    required,
    coveragePercent: required ? Math.round((covered / required) * 100) : 100,
    complete: starters.length === required && covered === required,
    positionTotals,
  }
}

function postTradePlayers(team: Team, outgoing: Asset[], incoming: Asset[]): Asset[] {
  const outgoingIds = new Set(outgoing.filter((asset) => asset.kind === 'player').map((asset) => asset.id))
  const remaining = team.players.filter((player) => !outgoingIds.has(player.id))
  const existingIds = new Set(remaining.map((player) => player.id))
  return [
    ...remaining,
    ...incoming.filter((asset) => asset.kind === 'player' && !existingIds.has(asset.id)),
  ]
}

export function currentSeasonPowerScenario(
  team: Team,
  outgoing: Asset[],
  incoming: Asset[],
  rosterPositions: string[],
): CurrentSeasonPowerScenario {
  const before = currentSeasonLineup(team.players, rosterPositions)
  const after = currentSeasonLineup(postTradePlayers(team, outgoing, incoming), rosterPositions)
  return {
    before,
    after,
    delta: before.complete && after.complete ? after.score - before.score : null,
  }
}

/** Direct league table from same-format redraft consensus values. Ties share a
 * competition rank; no dynasty value, age, picks, or hidden weights enter. */
export function buildTeamPowerTable(
  teams: Team[],
  rosterPositions: string[],
  targetRank: number,
): TeamPowerRow[] {
  const powers = teams.map((team) => ({ team, ...currentSeasonLineup(team.players, rosterPositions) }))
    .sort((a, b) => b.score - a.score || a.team.rosterId - b.team.rosterId)
  const boundedTargetRank = Math.max(1, Math.min(powers.length || 1, targetRank))
  const targetScore = powers[boundedTargetRank - 1]?.score ?? 0
  return powers.map((power, index) => ({
    ...power,
    rank: powers.findIndex((candidate) => candidate.score === power.score) + 1 || index + 1,
    gapToTarget: Math.max(0, targetScore - power.score),
    targetRank: boundedTargetRank,
    targetScore,
  }))
}
