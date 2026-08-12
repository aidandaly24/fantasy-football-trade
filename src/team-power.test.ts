import { describe, expect, it } from 'vitest'
import { buildTeamPowerTable, currentSeasonLineup, currentSeasonPowerScenario } from './team-power'
import type { Asset, Team } from './types'

function asset(id: string, position: Asset['position'], currentSeasonValue?: number): Asset {
  return {
    id,
    name: id,
    kind: 'player',
    position,
    team: null,
    value: currentSeasonValue ?? 500,
    currentSeasonValue,
    confidence: 1,
    age: 24,
    rank: null,
  }
}

function team(id: number, players: Asset[]): Team {
  return {
    rosterId: id,
    ownerId: String(id),
    ownerName: `Owner ${id}`,
    teamName: `Team ${id}`,
    avatar: null,
    players,
    picks: [],
    optimizedStarters: [],
    metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: 0, core: 0, depth: 0, picks: 0, liquidity: 0, market: 0, overall: 0, contender: 0, future: 0 },
  }
}

describe('current-season lineup power', () => {
  const slots = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX']

  it('optimizes a legal lineup from redraft values without mixing dynasty prices', () => {
    const players = [
      asset('qb1', 'QB', 900), asset('qb2', 'QB', 600),
      asset('rb1', 'RB', 500), asset('rb2', 'RB', 250),
      asset('wr1', 'WR', 450), asset('wr2', 'WR', 400),
      asset('te1', 'TE', 200),
    ]
    players[3].value = 999
    const power = currentSeasonLineup(players, slots)

    expect(power.score).toBe(3050)
    expect(power.starters.map((player) => player.id)).toEqual(['qb1', 'rb1', 'wr1', 'te1', 'wr2', 'qb2'])
    expect(power.complete).toBe(true)
  })

  it('reports coverage instead of treating an absent redraft value as evidence', () => {
    const power = currentSeasonLineup([asset('qb', 'QB')], ['QB'])
    expect(power).toMatchObject({ score: 0, covered: 0, required: 1, coveragePercent: 0, complete: false })
  })

  it('ranks the whole league and measures the gap to an explicit target rank', () => {
    const table = buildTeamPowerTable([
      team(1, [asset('one', 'QB', 700)]),
      team(2, [asset('two', 'QB', 500)]),
      team(3, [asset('three', 'QB', 300)]),
    ], ['QB'], 2)

    expect(table.map((row) => [row.team.rosterId, row.rank, row.gapToTarget])).toEqual([
      [1, 1, 0],
      [2, 2, 0],
      [3, 3, 200],
    ])
  })

  it('measures a trade only when both legal lineups are covered', () => {
    const mine = team(1, [asset('starter', 'RB', 200), asset('bench', 'RB', 100)])
    const upgrade = asset('upgrade', 'RB', 450)
    const scenario = currentSeasonPowerScenario(mine, [mine.players[1]], [upgrade], ['RB'])

    expect(scenario.before.score).toBe(200)
    expect(scenario.after.score).toBe(450)
    expect(scenario.delta).toBe(250)
  })
})
