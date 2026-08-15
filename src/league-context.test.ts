import { describe, expect, it } from 'vitest'
import { isSupportedLeagueId, leagueContext, projectionForLeague, SUPPORTED_LEAGUES } from './league-context'
import type { LeagueBundle, PlayerProjection } from './types'

function bundle(input: {
  id: string
  name: string
  tep: number
  positions: string[]
  draftRounds: number
  taxi: number
  reserve?: number
  teams?: number
  passingTd?: number
  maxKeepers?: number
}): LeagueBundle {
  const teams = input.teams ?? 12
  return {
    league: {
      league_id: input.id,
      name: input.name,
      season: '2026',
      status: 'in_season',
      total_rosters: teams,
      draft_id: null,
      avatar: null,
      roster_positions: input.positions,
      scoring_settings: { rec: 1, bonus_rec_te: input.tep, pass_td: input.passingTd ?? 4 },
      settings: { num_teams: teams, draft_rounds: input.draftRounds, max_keepers: input.maxKeepers, taxi_slots: input.taxi, reserve_slots: input.reserve },
    },
    rosters: [],
    users: [],
    tradedPicks: [],
    draft: null,
    draftPicks: [],
  }
}

const bc = bundle({
  id: '1336087922847289344',
  name: 'BC League',
  tep: 0.75,
  positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', ...Array(10).fill('BN')],
  draftRounds: 3,
  taxi: 2,
})

const emperor = bundle({
  id: '1312112570039037952',
  name: "Emperor Phil's League",
  tep: 0.5,
  positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', ...Array(14).fill('BN')],
  draftRounds: 4,
  taxi: 4,
  reserve: 2,
})

const freakbull = bundle({
  id: '1384007008004362240',
  name: 'National Freakbull League',
  tep: 0,
  positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', ...Array(5).fill('BN')],
  draftRounds: 3,
  taxi: 0,
  teams: 10,
  passingTd: 6,
  maxKeepers: 3,
})

describe('fixed private league context', () => {
  it('contains the two dynasty leagues plus a separate keeper-redraft league', () => {
    expect(SUPPORTED_LEAGUES.map((league) => league.id)).toEqual([
      '1336087922847289344',
      '1312112570039037952',
      '1384007008004362240',
    ])
    expect(SUPPORTED_LEAGUES.map((league) => league.leagueType)).toEqual(['dynasty', 'dynasty', 'keeper-redraft'])
    expect(isSupportedLeagueId('1336087922847289344')).toBe(true)
    expect(isSupportedLeagueId('1384007008004362240')).toBe(true)
    expect(isSupportedLeagueId('999999999999999999')).toBe(false)
    expect(() => leagueContext(bundle({
      id: '999999999999999999', name: 'Other', tep: 0, positions: ['QB'], draftRounds: 3, taxi: 0,
    }))).toThrow('private leagues')
  })

  it('keeps keeper-redraft scoring and market boundaries out of the dynasty lane', () => {
    const context = leagueContext(freakbull)
    expect(context).toMatchObject({
      leagueType: 'keeper-redraft',
      marketFormat: { numQbs: 1, tep: false, numTeams: 10 },
      scoring: { receptionPpr: 1, tePremiumPerReception: 0, passingTd: 6 },
      roster: { startingSlots: 8, skillStartingSlots: 8, benchSlots: 5, rookieDraftRounds: 0 },
    })
    expect(context.labels.market).toContain('current-season redraft')
    expect(context.labels.roster).toContain('seasonal draft')
  })

  it('preserves exact scoring and roster economics even when the provider bucket is the same', () => {
    const bcContext = leagueContext(bc)
    const emperorContext = leagueContext(emperor)
    expect(bcContext.marketFormat).toEqual({ numQbs: 2, tep: true, numTeams: 12 })
    expect(emperorContext.marketFormat).toEqual(bcContext.marketFormat)
    expect(bcContext).toMatchObject({
      scoring: { receptionPpr: 1, tePremiumPerReception: 0.75, passingTd: 4 },
      roster: { startingSlots: 9, skillStartingSlots: 9, benchSlots: 10, taxiSlots: 2, reserveSlots: 0, rookieDraftRounds: 3 },
    })
    expect(emperorContext).toMatchObject({
      scoring: { receptionPpr: 1, tePremiumPerReception: 0.5, passingTd: 4 },
      roster: { startingSlots: 11, skillStartingSlots: 9, benchSlots: 14, taxiSlots: 4, reserveSlots: 2, rookieDraftRounds: 4 },
    })
    expect(emperorContext.contextKey).not.toBe(bcContext.contextKey)
  })

  it('adds only the evidence-backed TE reception bonus to the generic model output', () => {
    const projection: PlayerProjection = {
      name: 'Tight End', position: 'TE', sourceSeason: 2025, gamesObserved: 17,
      expectedPpg: 10, floorPpg: 7, ceilingPpg: 14, confidence: 0.8, receptionsPerTeamWeek: 4,
    }
    const bcProjection = projectionForLeague(projection, leagueContext(bc))
    const emperorProjection = projectionForLeague(projection, leagueContext(emperor))
    expect(bcProjection).toMatchObject({ expectedPpg: 13, floorPpg: 10, ceilingPpg: 17, leagueAdjustmentPpg: 3, leagueAdjusted: true })
    expect(emperorProjection).toMatchObject({ expectedPpg: 12, floorPpg: 9, ceilingPpg: 16, leagueAdjustmentPpg: 2, leagueAdjusted: true })

    const receiver = projectionForLeague({ ...projection, position: 'WR' }, leagueContext(bc))
    expect(receiver.expectedPpg).toBe(10)
    expect(receiver.leagueAdjustmentPpg).toBe(0)
  })
})
