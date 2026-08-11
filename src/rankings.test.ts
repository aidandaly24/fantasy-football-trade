import { describe, expect, it } from 'vitest'
import { buildOwnedPicks, currentRoleValue, evaluateTrade, futurePickContext, optimizeLineup, packageValue, projectedLineupPpg, rosterProfile, scoreTeams } from './rankings'
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

  it('does not silently discount current market value from a depth-chart heuristic', () => {
    const starter = asset('starter', 'RB', 240)
    starter.depthChartOrder = 1
    const expensiveBackup = asset('backup', 'RB', 420)
    expensiveBackup.depthChartOrder = 2

    expect(currentRoleValue(expensiveBackup)).toBe(420)
    expect(optimizeLineup([starter, expensiveBackup], ['RB']).map((player) => player.id)).toEqual(['backup'])
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

  it('keeps every unresolved future pick at the provider midpoint with a factual range', () => {
    const scenarioValues: PickValue[] = [
      { id: 'pick_2027_1_01', name: '2027 Pick 1.01', round: 1, slot: 1, year: '2027', tier: 'early', composite: 600, position: 'PICK' },
      { id: 'pick_2027_1_06', name: '2027 Pick 1.06', round: 1, slot: 6, year: '2027', tier: 'mid', composite: 450, position: 'PICK' },
      { id: 'pick_2027_1_12', name: '2027 Pick 1.12', round: 1, slot: 12, year: '2027', tier: 'late', composite: 375, position: 'PICK' },
      { id: 'pick_2027_2_01', name: '2027 Pick 2.01', round: 2, slot: 1, year: '2027', tier: 'early', composite: 310, position: 'PICK' },
      { id: 'pick_2027_2_06', name: '2027 Pick 2.06', round: 2, slot: 6, year: '2027', tier: 'mid', composite: 267, position: 'PICK' },
      { id: 'pick_2027_2_12', name: '2027 Pick 2.12', round: 2, slot: 12, year: '2027', tier: 'late', composite: 224, position: 'PICK' },
    ]
    const picks = buildOwnedPicks({
      season: 2027,
      rounds: 2,
      rosterIds: [1, 2],
      tradedPicks: [],
      pickValues: scenarioValues,
      teamNames: new Map([[1, 'Strong'], [2, 'Weak']]),
    })
    const strongPicks = picks.get(1) ?? []
    const weakPicks = picks.get(2) ?? []

    expect(strongPicks.every((pick) => pick.projectedTier === 'mid')).toBe(true)
    expect(weakPicks.every((pick) => pick.projectedTier === 'mid')).toBe(true)
    expect(strongPicks.find((pick) => pick.round === 1)!.value).toBe(450)
    expect(weakPicks.find((pick) => pick.round === 1)!.value).toBe(450)
    expect(strongPicks.find((pick) => pick.round === 1)).toMatchObject({ valueLow: 375, valueHigh: 600 })
  })
})

describe('trade evaluation', () => {
  it('adds observed package values without hidden compression or elite bonuses', () => {
    const elite = [asset('elite', 'WR', 900)]
    const packageAssets = [asset('a', 'RB', 260), asset('b', 'WR', 260), asset('c', 'TE', 260)]

    expect(packageValue(elite)).toBe(900)
    expect(packageValue(packageAssets)).toBe(780)
    expect(evaluateTrade(elite, packageAssets).verdict).toContain('Side B')
  })

  it('reports the literal current-market gap without inventing a fair zone', () => {
    const result = evaluateTrade([asset('a', 'QB', 500)], [asset('b', 'RB', 490)])
    expect(result.marketNetA).toBe(-10)
    expect(result.verdict).toBe('Side B receives 10 more current market value')
  })

  it('changes only the observed market net when value is added to what it receives', () => {
    const baseline = evaluateTrade([asset('sent', 'QB', 500)], [asset('received', 'RB', 490)])
    const improved = evaluateTrade(
      [asset('sent', 'QB', 500)],
      [asset('received', 'RB', 490), asset('extra', 'WR', 120)],
    )

    expect(improved.marketNetA).toBeGreaterThan(baseline.marketNetA)
  })

  it('reports lineup impact and pick-value uncertainty separately from market value', () => {
    const outgoing = asset('bench', 'WR', 150)
    const incoming = asset('upgrade', 'QB', 600)
    const uncertainPick = asset('future-first', 'PICK', 449)
    uncertainPick.kind = 'pick'
    uncertainPick.valueLow = 377
    uncertainPick.valueHigh = 601
    uncertainPick.confidence = 0.68
    const teamA = team(1, [asset('starter', 'QB', 300)], [outgoing])
    const teamB = team(2, [incoming], [], [uncertainPick])
    const result = evaluateTrade([outgoing, uncertainPick], [incoming], {
      teamA,
      teamB,
      rosterPositions: ['QB'],
    })

    expect(result.lineupImpactA).toBeNull()
    expect(result.lineupScenarioA?.complete).toBe(false)
    expect(result.rangeA.worst).toBeLessThan(result.rangeA.best)
    expect(result.projectionCoverage).toBe(0)
  })

  it('uses held-out production projections only for lineup impact', () => {
    const starter = asset('starter', 'QB', 500)
    starter.depthChartOrder = 1
    starter.projectedPpg = 10
    const upgrade = asset('upgrade', 'QB', 500)
    upgrade.depthChartOrder = 1
    upgrade.projectedPpg = 14
    const outgoing = asset('pick', 'PICK', 500)
    outgoing.kind = 'pick'
    const result = evaluateTrade([outgoing], [upgrade], {
      teamA: team(1, [starter], [], [outgoing]),
      teamB: team(2, [upgrade]),
      rosterPositions: ['QB'],
    })

    expect(projectedLineupPpg(upgrade)).toBe(14)
    expect(result.lineupImpactA).toBe(4)
    expect(result.projectionCoverage).toBe(100)
    expect(result.marketNetA).toBe(0)
  })

  it('guards every production scenario when the likely lineup is not fully covered', () => {
    const uncoveredStarter = asset('uncovered-starter', 'QB', 700)
    const coveredIncoming = asset('covered-incoming', 'QB', 800)
    coveredIncoming.projectedPpg = 15
    coveredIncoming.projectedPpgFloor = 9
    coveredIncoming.projectedPpgCeiling = 21

    const result = evaluateTrade([], [coveredIncoming], {
      teamA: team(1, [uncoveredStarter]),
      teamB: team(2, [coveredIncoming]),
      rosterPositions: ['QB'],
    })

    expect(result.lineupImpactA).toBeNull()
    expect(result.lineupScenarioA?.beforeCoverage).toEqual({ covered: 0, required: 1, percent: 0 })
    expect(result.lineupScenarioA?.afterCoverage.percent).toBe(100)
  })

  it('keeps production floor, expectation, and ceiling as separate lineup scenarios', () => {
    const starter = asset('starter', 'QB', 500)
    Object.assign(starter, { projectedPpg: 10, projectedPpgFloor: 8, projectedPpgCeiling: 13 })
    const incoming = asset('incoming', 'QB', 600)
    Object.assign(incoming, { projectedPpg: 12, projectedPpgFloor: 9, projectedPpgCeiling: 17 })

    const result = evaluateTrade([], [incoming], {
      teamA: team(1, [starter]),
      teamB: team(2, [incoming]),
      rosterPositions: ['QB'],
    })

    expect(result.lineupScenarioA).toMatchObject({
      floorDelta: 1,
      expectedDelta: 2,
      ceilingDelta: 4,
      complete: true,
    })
  })

  it('shows KTC and FantasyCalc package nets without blending away disagreement', () => {
    const sent = asset('sent', 'WR', 500)
    sent.marketSources = { ktc: 480, fantasycalc: 520 }
    const received = asset('received', 'WR', 600)
    received.marketSources = { ktc: 620, fantasycalc: 570 }

    const result = evaluateTrade([sent], [received], { horizonYears: 3 })

    expect(result.providerNetA).toEqual({ ktc: 140, fantasycalc: 50 })
    expect(result.packageA.providerCoveragePercent).toBe(100)
    expect(result.packageB.averageAgeAtHorizon).toBeNull()
  })

  it('keeps current price and factual role warnings separate', () => {
    const lateFirst = asset('1.12', 'PICK', 360)
    lateFirst.kind = 'pick'
    lateFirst.projectionConfidence = 0.95
    const earlySecond = asset('2.02', 'PICK', 250)
    earlySecond.kind = 'pick'
    earlySecond.projectionConfidence = 0.95
    const shough = asset('Tyler Shough', 'QB', 408)
    shough.depthChartOrder = 1
    const corum = asset('Blake Corum', 'RB', 275)
    corum.depthChartOrder = 2
    const myQb = asset('my-qb', 'QB', 300)
    myQb.depthChartOrder = 1
    const myRb = asset('my-rb', 'RB', 260)
    myRb.depthChartOrder = 1
    const theirRb = asset('their-rb', 'RB', 240)
    theirRb.depthChartOrder = 1

    const result = evaluateTrade([lateFirst, earlySecond], [shough, corum], {
      teamA: team(1, [myQb, myRb]),
      teamB: team(2, [shough, theirRb], [corum]),
      rosterPositions: ['QB', 'RB'],
    })

    expect(result.marketNetA).toBeGreaterThan(0)
    expect(result.riskNotesA[0]).toContain('RB2')
    expect(result.verdict).toContain('Team 1 receives')
  })

  it('does not convert market value into fallback fantasy points', () => {
    expect(projectedLineupPpg(asset('uncovered', 'WR', 900))).toBe(0)
  })
})

describe('league-relative roster scoring', () => {
  it('penalizes a missing starting slot and rewards usable depth above replacement', () => {
    const strong = team(1, [asset('s-qb', 'QB', 900), asset('s-rb', 'RB', 800)], [asset('s-depth', 'RB', 650)])
    const thin = team(2, [asset('t-qb', 'QB', 900)], [asset('t-depth', 'RB', 100)])
    const middle = team(3, [asset('m-qb', 'QB', 650), asset('m-rb', 'RB', 550)], [asset('m-depth', 'RB', 300)])
    strong.players.forEach((player) => { player.projectedPpg = 10 })
    thin.players.forEach((player) => { player.projectedPpg = 10 })
    middle.players.forEach((player) => { player.projectedPpg = 8 })
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
