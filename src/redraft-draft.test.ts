import { describe, expect, it } from 'vitest'
import { availableRedraftBoard, buildRedraftDraftPlan, snakeOverallPick } from './redraft-draft'
import type { LeagueBundle, TradyrPlayer } from './types'

function leagueBundle(): LeagueBundle {
  return {
    league: {
      league_id: '1384007008004362240',
      name: 'National Freakbull League',
      season: '2026',
      status: 'pre_draft',
      total_rosters: 10,
      draft_id: 'draft-1',
      avatar: null,
      roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN'],
      scoring_settings: { rec: 1, pass_td: 6 },
      settings: { num_teams: 10, draft_rounds: 3, max_keepers: 3 },
    },
    rosters: [{ roster_id: 7, owner_id: 'aidan', players: null, starters: null, keepers: null, reserve: null, taxi: null }],
    users: [],
    tradedPicks: [],
    draft: {
      draft_id: 'draft-1', season: '2026', status: 'pre_draft', type: 'snake',
      draft_order: { aidan: 4 }, slot_to_roster_id: null, settings: { teams: 10, rounds: 13 },
    },
    draftPicks: [],
  }
}

describe('keeper-redraft pre-draft model', () => {
  it('maps a normal snake slot to exact overall pick windows', () => {
    expect(snakeOverallPick(1, 4, 10)).toBe(4)
    expect(snakeOverallPick(2, 4, 10)).toBe(17)
    expect(snakeOverallPick(3, 4, 10)).toBe(24)
    expect(buildRedraftDraftPlan(leagueBundle(), 7).pickWindows.map((pick) => pick.overallPick))
      .toEqual([4, 17, 24, 37, 44, 57])
  })

  it('keeps fixed starters and shared flex pressure separate', () => {
    const plan = buildRedraftDraftPlan(leagueBundle(), 7)
    expect(plan).toMatchObject({ draftSlot: 4, teamCount: 10, rounds: 13, keeperLimit: 3, myKeepers: 0 })
    expect(plan.starterDemand.find((row) => row.position === 'RB')).toMatchObject({ perTeam: 2, leagueWide: 20 })
    expect(plan.starterDemand.find((row) => row.position === 'FLEX')).toMatchObject({ perTeam: 2, leagueWide: 20 })
  })

  it('removes recorded picks from the current-season board', () => {
    const players = [
      { slug: 'one', name: 'One', position: 'RB', team: 'A', age: 24, composite: 90, confidence: 1, rank: 1, posRank: 1, sources: { ktc: 90, fantasycalc: 90 }, sleeperId: '1' },
      { slug: 'two', name: 'Two', position: 'WR', team: 'B', age: 25, composite: 80, confidence: 1, rank: 2, posRank: 1, sources: { ktc: 80, fantasycalc: 80 }, sleeperId: '2' },
    ] satisfies TradyrPlayer[]
    const available = availableRedraftBoard(players, [{ player_id: '1', picked_by: 'x', roster_id: 1, pick_no: 1, round: 1, draft_slot: 1 }])
    expect(available.map((player) => player.name)).toEqual(['Two'])
  })
})
