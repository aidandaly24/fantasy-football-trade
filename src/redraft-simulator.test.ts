import { describe, expect, it } from 'vitest'
import { availableRedraftRankings, draftPickLabel, draftPlayersForLeague, draftSlotAtOverallPick, leagueProjectedPoints, runRedraftMockDrafts } from './redraft-simulator'
import type { LeagueBundle, RedraftDraftPool, RedraftDraftProjection } from './types'

function bundle(): LeagueBundle {
  return {
    league: {
      league_id: '1384007008004362240', name: 'Freakbull', season: '2026', status: 'pre_draft', total_rosters: 10,
      draft_id: 'draft', avatar: null,
      roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN'],
      scoring_settings: { pass_yd: 0.04, pass_td: 6, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2 },
      settings: { num_teams: 10, draft_rounds: 3, max_keepers: 3 },
    },
    rosters: Array.from({ length: 10 }, (_, index) => ({ roster_id: index + 1, owner_id: `owner-${index + 1}`, players: null, starters: null, reserve: null, taxi: null })),
    users: [], tradedPicks: [], draftPicks: [],
    draft: {
      draft_id: 'draft', season: '2026', status: 'pre_draft', type: 'snake', slot_to_roster_id: null,
      draft_order: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`owner-${index + 1}`, index + 1])),
      settings: { teams: 10, rounds: 13 },
    },
  }
}

function projection(index: number): RedraftDraftProjection {
  const position = (['RB', 'WR', 'QB', 'TE'] as const)[index % 4]
  return {
    playerId: String(index + 1), name: `Player ${index + 1}`, position, team: 'NFL', injuryStatus: null, company: 'test',
    stats: {
      adpPpr: index + 1, ptsPpr: 300 - index,
      passYd: position === 'QB' ? 4000 - index * 2 : 0,
      passTd: position === 'QB' ? 30 : 0,
      passInt: position === 'QB' ? 10 : 0,
      pass2pt: 0,
      rushYd: position === 'RB' ? 1300 - index : 0,
      rushTd: position === 'RB' ? 10 : 0,
      rush2pt: 0,
      rec: position === 'WR' || position === 'TE' ? 90 - index / 3 : position === 'RB' ? 50 : 0,
      recYd: position === 'WR' || position === 'TE' ? 1200 - index : position === 'RB' ? 400 : 0,
      recTd: position === 'WR' || position === 'TE' ? 8 : position === 'RB' ? 2 : 0,
      rec2pt: 0, fumLost: 1,
    },
  }
}

function pool(): RedraftDraftPool {
  return { season: '2026', generatedAt: '2026-08-16T12:00:00.000Z', source: 'test', players: Array.from({ length: 180 }, (_, index) => projection(index)) }
}

describe('snake mock draft model', () => {
  it('maps both sides of the snake and formats the actual pick', () => {
    expect(draftSlotAtOverallPick(4, 10)).toBe(4)
    expect(draftSlotAtOverallPick(17, 10)).toBe(4)
    expect(draftSlotAtOverallPick(24, 10)).toBe(4)
    expect(draftPickLabel(17, 10)).toBe('2.07')
    expect(draftPickLabel(24, 10)).toBe('3.04')
  })

  it('uses the league six-point passing-touchdown scoring', () => {
    const qb = projection(2)
    expect(leagueProjectedPoints(qb, bundle().league.scoring_settings)).toBe(327.8)
    expect(draftPlayersForLeague(pool(), bundle()).find((player) => player.playerId === qb.playerId)?.projectedPoints).toBe(327.8)
  })

  it('runs deterministic full-draft paths and produces contingent pick recommendations', () => {
    const league = bundle()
    const first = runRedraftMockDrafts(league, pool(), 4, { simulations: 24, scenarioSimulations: 12 })
    const second = runRedraftMockDrafts(league, pool(), 4, { simulations: 24, scenarioSimulations: 12 })
    expect(first.nextUserOverallPick).toBe(4)
    expect(first.followingUserOverallPick).toBe(17)
    expect(first.candidates.length).toBeGreaterThan(2)
    expect(first.roundPlans.map((round) => round.overallPick).slice(0, 3)).toEqual([4, 17, 24])
    expect(first.builds[0]?.picks).toHaveLength(13)
    first.builds.forEach((build) => {
      const positions = build.picks.map((pick) => pick.player.position)
      expect(positions.filter((position) => position === 'QB').length).toBeGreaterThanOrEqual(1)
      expect(positions.filter((position) => position === 'QB').length).toBeLessThanOrEqual(2)
      expect(positions.filter((position) => position === 'TE').length).toBeGreaterThanOrEqual(1)
      expect(positions.filter((position) => position === 'TE').length).toBeLessThanOrEqual(2)
      expect(positions.filter((position) => position === 'RB').length).toBeGreaterThanOrEqual(2)
      expect(positions.filter((position) => position === 'WR').length).toBeGreaterThanOrEqual(2)
    })
    expect(second).toEqual(first)
  })

  it('maps the user by roster id when seat and roster numbers differ', () => {
    const league = bundle()
    league.draft!.slot_to_roster_id = { '1': 4, '2': 3, '3': 5, '4': 7, '5': 1, '6': 6, '7': 2, '8': 9, '9': 10, '10': 8 }
    const result = runRedraftMockDrafts(league, pool(), 7, { simulations: 16, scenarioSimulations: 8 })
    expect(result.nextUserOverallPick).toBe(4)
    expect(result.followingUserOverallPick).toBe(17)
  })

  it('removes recorded live picks before recommending the next roster turn', () => {
    const league = bundle()
    league.draftPicks = [
      { player_id: '1', picked_by: 'owner-1', roster_id: 1, pick_no: 1, round: 1, draft_slot: 1 },
      { player_id: '2', picked_by: 'owner-2', roster_id: 2, pick_no: 2, round: 1, draft_slot: 2 },
      { player_id: '3', picked_by: 'owner-3', roster_id: 3, pick_no: 3, round: 1, draft_slot: 3 },
    ]
    const result = runRedraftMockDrafts(league, pool(), 4, { simulations: 16, scenarioSimulations: 8 })
    expect(result.currentOverallPick).toBe(4)
    expect(result.candidates.map((candidate) => candidate.player.playerId)).not.toContain('1')
  })

  it('builds a complete ADP board with stable overall and position ranks', () => {
    const league = bundle()
    league.rosters[0].keepers = ['1']
    league.draftPicks = [
      { player_id: '2', picked_by: 'owner-2', roster_id: 2, pick_no: 1, round: 1, draft_slot: 1 },
    ]

    const rankings = availableRedraftRankings(pool(), league)

    expect(rankings).toHaveLength(178)
    expect(rankings.map((player) => player.playerId)).not.toContain('1')
    expect(rankings.map((player) => player.playerId)).not.toContain('2')
    expect(rankings[0]).toMatchObject({ playerId: '3', overallRank: 3, position: 'QB', positionRank: 1 })
    expect(rankings.find((player) => player.playerId === '4')).toMatchObject({ overallRank: 4, positionRank: 1 })
  })
})
