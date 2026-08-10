import { describe, expect, it } from 'vitest'
import { buildOwnedPicks, evaluateTrade, futurePickContext, optimizeLineup, packageValue, rosterProfile, scoreTeams } from './rankings'
import type { Asset, LeagueBundle, PickValue, Team } from './types'

function asset(id: string, position: Asset['position'], value: number): Asset {
  return {
    id,
    name: id,
    kind: 'player',
    position,
    team: null,
    value,
    confidence: 1,
    age: null,
    rank: null,
  }
}

function team(id: number, starters: Asset[], bench: Asset[] = [], picks: Asset[] = []): Team {
  return {
    rosterId: id,
    ownerId: String(id),
    ownerName: `Owner ${id}`,
    teamName: `Team ${id}`,
    avatar: null,
    players: [...starters, ...bench],
    picks,
    optimizedStarters: starters,
    metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: 0, core: 0, depth: 0, picks: 0, liquidity: 0, market: 0, overall: 0, contender: 0, future: 0 },
  }
}

describe('optimizeLineup', () => {
  it('fills Superflex with a second quarterback while preserving required slots', () => {
    const players = [
      asset('qb1', 'QB', 900),
      asset('qb2', 'QB', 700),
      asset('rb1', 'RB', 650),
      asset('rb2', 'RB', 500),
      asset('wr1', 'WR', 800),
      asset('wr2', 'WR', 600),
      asset('te1', 'TE', 550),
    ]
    const lineup = optimizeLineup(players, ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'])

    expect(lineup.map((player) => player.id)).toEqual(['qb1', 'rb1', 'wr1', 'te1', 'wr2', 'qb2'])
    expect(new Set(lineup.map((player) => player.id)).size).toBe(lineup.length)
  })
})

describe('buildOwnedPicks', () => {
  const pickValues: PickValue[] = [
    { id: 'pick_2026_1_02', name: '2026 Pick 1.02', round: 1, slot: 2, year: '2026', tier: 'early', composite: 500, position: 'PICK' },
    { id: 'pick_2026_1_06', name: '2026 Pick 1.06', round: 1, slot: 6, year: '2026', tier: 'mid', composite: 390, position: 'PICK' },
    { id: 'pick_2027_1_01', name: '2027 Pick 1.01', round: 1, slot: 1, year: '2027', tier: 'early', composite: 600, position: 'PICK' },
  ]

  it('moves a traded pick to its current owner and keeps the original slot identity', () => {
    const picks = buildOwnedPicks({
      season: 2026,
      rounds: 1,
      rosterIds: [1, 2],
      tradedPicks: [{ season: '2026', round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 }],
      pickValues,
      slotToRosterId: { '2': 1, '6': 2 },
      teamNames: new Map([[1, 'Alpha'], [2, 'Bravo']]),
    })

    expect(picks.get(1)?.some((pick) => pick.id === 'pick:2026:1:1')).toBe(false)
    const traded = picks.get(2)?.find((pick) => pick.id === 'pick:2026:1:1')
    expect(traded?.name).toBe('2026 1.02')
    expect(traded?.value).toBe(500)
  })

  it('starts after a completed rookie draft and never reuses that draft order', () => {
    const leagueBundle = {
      league: { season: '2026' },
      draft: { season: '2026', status: 'complete', slot_to_roster_id: { '2': 1 } },
    } as unknown as LeagueBundle
    const availableValues: PickValue[] = [
      ...pickValues,
      { id: 'pick_2028_1_06', name: '2028 Pick 1.06', round: 1, slot: 6, year: '2028', tier: 'mid', composite: 350, position: 'PICK' },
    ]
    const context = futurePickContext(leagueBundle, availableValues)
    const picks = buildOwnedPicks({
      season: context.firstSeason,
      seasons: context.seasons,
      exactSlotSeason: context.exactSlotSeason,
      rounds: 1,
      rosterIds: [1],
      tradedPicks: [],
      pickValues: availableValues,
      slotToRosterId: leagueBundle.draft?.slot_to_roster_id,
      teamNames: new Map([[1, 'Alpha']]),
    }).get(1) ?? []

    expect(context).toEqual({ firstSeason: 2027, seasons: [2027, 2028], exactSlotSeason: null })
    expect(picks.map((pick) => pick.year)).toEqual(['2027', '2028'])
    expect(picks[0].name).toBe('2027 1st · from Alpha')
  })
})

describe('trade evaluation', () => {
  it('applies diminishing weight to additional package pieces', () => {
    const elite = [asset('elite', 'WR', 900)]
    const packageAssets = [asset('a', 'RB', 260), asset('b', 'WR', 260), asset('c', 'TE', 260)]

    expect(packageValue(elite)).toBeGreaterThan(packageValue(packageAssets))
    expect(evaluateTrade(elite, packageAssets).verdict).toContain('Side A')
  })

  it('calls nearly equal adjusted packages fair', () => {
    const result = evaluateTrade([asset('a', 'QB', 500)], [asset('b', 'RB', 490)])
    expect(result.fair).toBe(true)
    expect(result.verdict).toBe('Dead even')
  })
})

describe('league-relative roster scoring', () => {
  it('penalizes a missing starting slot and rewards usable depth above replacement', () => {
    const strong = team(1, [asset('s-qb', 'QB', 900), asset('s-rb', 'RB', 800)], [asset('s-depth', 'RB', 650)])
    const thin = team(2, [asset('t-qb', 'QB', 900)], [asset('t-depth', 'RB', 100)])
    const middle = team(3, [asset('m-qb', 'QB', 650), asset('m-rb', 'RB', 550)], [asset('m-depth', 'RB', 300)])
    const scored = scoreTeams([strong, thin, middle])

    expect(scored[0].metrics.lineup).toBeGreaterThan(scored[1].metrics.lineup)
    expect(scored[0].metrics.depth).toBeGreaterThan(scored[1].metrics.depth)
  })

  it('rewards total draft capital instead of averaging picks', () => {
    const first = asset('pick1', 'PICK', 500)
    first.kind = 'pick'
    const second = asset('pick2', 'PICK', 350)
    second.kind = 'pick'
    const scored = scoreTeams([
      team(1, [asset('qb1', 'QB', 500)], [], [first, second]),
      team(2, [asset('qb2', 'QB', 500)], [], [first]),
    ])

    expect(scored[0].metrics.picks).toBeGreaterThan(scored[1].metrics.picks)
  })

  it('uses evidence-based profiles rather than generic win-now tags', () => {
    const scored = scoreTeams([
      team(1, [asset('a1', 'QB', 900), asset('a2', 'RB', 850)]),
      team(2, [asset('b1', 'QB', 500), asset('b2', 'RB', 450)]),
      team(3, [asset('c1', 'QB', 350), asset('c2', 'RB', 300)]),
      team(4, [asset('d1', 'QB', 200), asset('d2', 'RB', 180)]),
    ])
    const profile = rosterProfile(scored[0], scored)

    expect(profile.label).not.toMatch(/win-now|reloading/i)
    expect(profile.description).toContain('#')
  })
})
