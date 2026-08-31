import { describe, expect, it } from 'vitest'
import type { LeagueContext } from './league-context'
import type { Asset, PlayerProjection, SleeperPlayer, Team } from './types'
import {
  buildWeeklyCandidates,
  hydrateLineupTeam,
  optimizeWeeklyLineup,
  submittedLineupDelta,
  type WeeklyProjectionBundle,
} from './weekly-lineup'

function asset(id: string, position: Asset['position'], team: string | null = 'BUF', extra: Partial<Asset> = {}): Asset {
  return {
    id, name: id, kind: 'player', position, team, value: 0, confidence: 0, age: 24, rank: null,
    ...extra,
  }
}

function team(players: Asset[]): Team {
  return {
    rosterId: 2, ownerId: 'me', ownerName: 'me', teamName: 'Mine', avatar: null,
    players, picks: [], optimizedStarters: [],
    metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: 0, core: 0, depth: 0, picks: 0, liquidity: 0, market: 0, overall: 0, contender: 0, future: 0 },
  }
}

function context(tep = 0.75, passingInterception = -2): LeagueContext {
  return {
    id: '1336087922847289344', leagueType: 'dynasty', label: 'BC', leagueName: 'BC', contextKey: 'bc',
    marketFormat: { numQbs: 2, tep: true, numTeams: 12 },
    scoring: { receptionPpr: 1, tePremiumPerReception: tep, passingTd: 4, passingInterception },
    roster: { startingSlots: 9, skillStartingSlots: 9, benchSlots: 10, taxiSlots: 2, reserveSlots: 0, rookieDraftRounds: 3 },
    labels: { format: '', roster: '', market: '', projection: '' },
  }
}

function bundle(projections: WeeklyProjectionBundle['projections'] = {}): WeeklyProjectionBundle {
  return {
    season: 2026, week: 1, status: 'ready', generatedAt: '2026-09-03T00:00:00Z', sourceDate: '2026-09-03',
    source: { name: 'DynastyProcess weekly FantasyPros consensus', url: 'https://example.com', pointMethod: 'rank-to-points' },
    projections,
    games: {
      BUF: { team: 'BUF', opponent: 'NE', home: true, gameday: '2026-09-13', gametime: '13:00', kickoffOrder: '2026-09-13T13:00' },
      DAL: { team: 'DAL', opponent: 'NYG', home: true, gameday: '2026-09-13', gametime: '20:20', kickoffOrder: '2026-09-13T20:20' },
    },
    scheduleComplete: false,
    coverage: { sourceRows: Object.keys(projections).length, matchedSleeperPlayers: Object.keys(projections).length, scheduleTeams: 2 },
    warnings: [],
  }
}

function weekly(playerId: string, position: 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF', points: number, team = 'BUF') {
  return {
    playerId, name: playerId, position, team, points, rank: 1, positionRank: `${position}1`, ecr: 1,
    expertSd: 1, bestRank: 1, worstRank: 3, opponent: 'vs. NE', tag: 'start', grade: 'A',
  }
}

describe('weekly lineup engine', () => {
  it('applies each league TE premium without changing the source PPR number', () => {
    const roster = team([asset('te', 'TE')])
    const data = bundle({ te: weekly('te', 'TE', 10) })
    const projections = new Map<string, PlayerProjection>([['te', {
      name: 'TE', position: 'TE', sourceSeason: 2025, gamesObserved: 17,
      expectedPpg: 10, floorPpg: 6, ceilingPpg: 15, confidence: 0.8, receptionsPerTeamWeek: 4,
    }]])

    const bc = buildWeeklyCandidates(roster, data, projections, context(0.75))[0]
    const phil = buildWeeklyCandidates(roster, data, projections, context(0.5))[0]

    expect(bc).toMatchObject({ basePoints: 10, tepAdjustment: 3, points: 13, scoringComplete: true })
    expect(phil).toMatchObject({ basePoints: 10, tepAdjustment: 2, points: 12, scoringComplete: true })
  })

  it('uses stable Sleeper identity to hydrate kicker and injury metadata', () => {
    const original = team([asset('kick', 'NA', null)])
    const sleeper = new Map<string, SleeperPlayer>([['kick', {
      player_id: 'kick', full_name: 'Real Kicker', position: 'K', team: 'DAL', active: true, injury_status: null,
    }]])
    const hydrated = hydrateLineupTeam(original, sleeper)
    expect(hydrated.players[0]).toMatchObject({ name: 'Real Kicker', position: 'K', team: 'DAL', active: true })
  })

  it('builds the best legal lineup and keeps the later player in FLEX', () => {
    const roster = team([
      asset('qb1', 'QB'), asset('qb2', 'QB', 'DAL'),
      asset('rb-early', 'RB', 'BUF'), asset('rb-late', 'RB', 'DAL'),
      asset('wr', 'WR'), asset('te', 'TE'),
    ])
    const data = bundle(Object.fromEntries([
      weekly('qb1', 'QB', 20), weekly('qb2', 'QB', 18, 'DAL'), weekly('rb-early', 'RB', 10),
      weekly('rb-late', 'RB', 12, 'DAL'), weekly('wr', 'WR', 11), weekly('te', 'TE', 8),
    ].map((projection) => [projection.playerId, projection])))
    const candidates = buildWeeklyCandidates(roster, data, new Map(), context(0))
    const result = optimizeWeeklyLineup(candidates, ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'])

    expect(result.complete).toBe(true)
    expect(result.total).toBe(79)
    expect(result.slots.map((slot) => [slot.slot, slot.candidate?.asset.id])).toEqual([
      ['QB', 'qb1'], ['RB', 'rb-early'], ['WR', 'wr'], ['TE', 'te'], ['FLEX', 'rb-late'], ['SUPER_FLEX', 'qb2'],
    ])
  })

  it('supports Phil kicker/defense slots and keeps unsupported scoring explicit', () => {
    const roster = team([asset('qb', 'QB'), asset('k', 'K'), asset('DAL', 'DEF', 'DAL')])
    const data = bundle({ qb: weekly('qb', 'QB', 20), k: weekly('k', 'K', 8), 'DEF:DAL': weekly('DEF:DAL', 'DEF', 7, 'DAL') })
    const candidates = buildWeeklyCandidates(roster, data, new Map(), context(0.5, -1))
    const result = optimizeWeeklyLineup(candidates, ['QB', 'K', 'DEF'])

    expect(result).toMatchObject({ complete: true, covered: 3, required: 3, exactScoringCovered: 0 })
  })

  it('never substitutes season-transition points when the weekly board is not published', () => {
    const roster = team([asset('ward', 'QB'), asset('burrow', 'QB')])
    const projections = new Map<string, PlayerProjection>([['ward', {
      name: 'Cam Ward', position: 'QB', sourceSeason: 2025, gamesObserved: 17,
      expectedPpg: 10.9, floorPpg: 3.7, ceilingPpg: 14.8, confidence: 0.76,
    }], ['burrow', {
      name: 'Joe Burrow', position: 'QB', sourceSeason: 2025, gamesObserved: 8,
      expectedPpg: 5, floorPpg: 0, ceilingPpg: 12.2, confidence: 0.6,
    }]])
    const candidates = buildWeeklyCandidates(roster, { ...bundle(), status: 'not-published' }, projections, context(0.5, -1))
    const recommendation = optimizeWeeklyLineup(candidates, ['QB'])

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ asset: expect.objectContaining({ id: 'ward' }), source: 'unavailable', points: null }),
      expect.objectContaining({ asset: expect.objectContaining({ id: 'burrow' }), source: 'unavailable', points: null }),
    ]))
    expect(recommendation).toMatchObject({ complete: false, covered: 0, weeklySourceCount: 0 })
    expect(submittedLineupDelta(['burrow'], recommendation, candidates)).toEqual({ incoming: [], outgoing: [], projectedDelta: null })
  })

  it('excludes reserve and confirmed-out players rather than discounting them with invented weights', () => {
    const roster = team([
      asset('healthy', 'RB'),
      asset('reserve', 'RB', 'BUF', { isReserve: true }),
      asset('out', 'RB', 'BUF', { injuryStatus: 'Out' }),
    ])
    const data = bundle({
      healthy: weekly('healthy', 'RB', 10), reserve: weekly('reserve', 'RB', 30), out: weekly('out', 'RB', 25),
    })
    const candidates = buildWeeklyCandidates(roster, data, new Map(), context(0))
    const result = optimizeWeeklyLineup(candidates, ['RB'])

    expect(result.starters[0].asset.id).toBe('healthy')
    expect(candidates.find((candidate) => candidate.asset.id === 'reserve')).toMatchObject({ eligible: false, availability: 'reserve' })
    expect(candidates.find((candidate) => candidate.asset.id === 'out')).toMatchObject({ eligible: false, availability: 'out' })
  })

  it('does not start a player without an NFL team when the schedule is complete', () => {
    const roster = team([asset('free-agent', 'RB', null)])
    const data = { ...bundle({ 'free-agent': weekly('free-agent', 'RB', 20) }), scheduleComplete: true }
    const candidate = buildWeeklyCandidates(roster, data, new Map(), context(0))[0]

    expect(candidate).toMatchObject({ eligible: false, availability: 'inactive', availabilityNote: 'Player has no current NFL team.' })
  })

  it('compares a submitted lineup only when both totals are covered', () => {
    const roster = team([asset('better', 'RB'), asset('worse', 'RB')])
    const data = bundle({ better: weekly('better', 'RB', 15), worse: weekly('worse', 'RB', 10) })
    const candidates = buildWeeklyCandidates(roster, data, new Map(), context(0))
    const result = optimizeWeeklyLineup(candidates, ['RB'])

    expect(submittedLineupDelta(['worse'], result, candidates)).toMatchObject({ projectedDelta: 5 })
  })

  it('fills the exact BC and Emperor Phil starting shapes while preserving their scoring differences', () => {
    const players = [
      asset('qb1', 'QB'), asset('qb2', 'QB'),
      asset('rb1', 'RB'), asset('rb2', 'RB'), asset('rb3', 'RB'),
      asset('wr1', 'WR'), asset('wr2', 'WR'), asset('wr3', 'WR'),
      asset('te1', 'TE'), asset('k1', 'K'), asset('BUF', 'DEF', 'BUF'),
    ]
    const weeklyRows = Object.fromEntries(players.map((player, index) => {
      const id = player.position === 'DEF' ? 'DEF:BUF' : player.id
      return [id, weekly(id, player.position as 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF', 22 - index)]
    }))
    const fallback = new Map<string, PlayerProjection>([['te1', {
      name: 'TE', position: 'TE', sourceSeason: 2025, gamesObserved: 17,
      expectedPpg: 10, floorPpg: 6, ceilingPpg: 15, confidence: 0.8, receptionsPerTeamWeek: 4,
    }]])
    const data = bundle(weeklyRows)
    const bcCandidates = buildWeeklyCandidates(team(players), data, fallback, context(0.75, -2))
    const philCandidates = buildWeeklyCandidates(team(players), data, fallback, context(0.5, -1))
    const bc = optimizeWeeklyLineup(bcCandidates, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX'])
    const phil = optimizeWeeklyLineup(philCandidates, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', 'K', 'DEF'])

    expect(bc).toMatchObject({ required: 9, covered: 9, exactScoringCovered: 9 })
    expect(phil).toMatchObject({ required: 11, covered: 11, exactScoringCovered: 7 })
  })
})
