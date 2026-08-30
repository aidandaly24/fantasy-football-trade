import type { LeagueBundle, MarketTapeLeagueContext, PlayerProjection } from './types'

export const SUPPORTED_LEAGUES = [
  { id: '1336087922847289344', label: 'BC League', leagueType: 'dynasty', ownerHandle: 'aidandaly20', marketFormat: { numQbs: 2, tep: true, numTeams: 12 } },
  { id: '1312112570039037952', label: 'Emperor Phil', leagueType: 'dynasty', ownerHandle: 'aidandaly20', marketFormat: { numQbs: 2, tep: true, numTeams: 12 } },
  { id: '1384007008004362240', label: 'Freakbull', leagueType: 'keeper-redraft', ownerHandle: 'aidandaly20', marketFormat: { numQbs: 1, tep: false, numTeams: 10 } },
] as const

export type SupportedLeagueId = typeof SUPPORTED_LEAGUES[number]['id']

export type LeagueContext = {
  id: SupportedLeagueId
  leagueType: 'dynasty' | 'keeper-redraft'
  label: string
  leagueName: string
  contextKey: string
  marketFormat: {
    numQbs: 1 | 2
    tep: boolean
    numTeams: number
  }
  scoring: {
    receptionPpr: number
    tePremiumPerReception: number
    passingTd: number
    passingInterception: number
  }
  roster: {
    startingSlots: number
    skillStartingSlots: number
    benchSlots: number
    taxiSlots: number
    reserveSlots: number
    rookieDraftRounds: number
  }
  labels: {
    format: string
    roster: string
    market: string
    projection: string
  }
}

const SKILL_STARTERS = new Set(['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'])

function score(bundle: LeagueBundle, key: string, fallback: number): number {
  const value = Number(bundle.league.scoring_settings[key])
  return Number.isFinite(value) ? value : fallback
}

export function isSupportedLeagueId(value: string | null | undefined): value is SupportedLeagueId {
  return SUPPORTED_LEAGUES.some((league) => league.id === value)
}

export function leagueContext(bundle: LeagueBundle): LeagueContext {
  const { league } = bundle
  if (!isSupportedLeagueId(league.league_id)) {
    throw new Error('RosterLab is configured only for the private leagues in the league switcher.')
  }
  const preset = SUPPORTED_LEAGUES.find((item) => item.id === league.league_id)!
  const superflex = league.roster_positions.includes('SUPER_FLEX')
  const qbs = league.roster_positions.filter((slot) => slot === 'QB').length
  const numQbs: 1 | 2 = superflex || qbs > 1 ? 2 : 1
  const numTeams = league.total_rosters
  const receptionPpr = score(bundle, 'rec', 1)
  const tePremiumPerReception = score(bundle, 'bonus_rec_te', 0)
  const passingTd = score(bundle, 'pass_td', 4)
  const passingInterception = score(bundle, 'pass_int', -2)
  const startingSlots = league.roster_positions.filter((slot) => slot !== 'BN').length
  const skillStartingSlots = league.roster_positions.filter((slot) => SKILL_STARTERS.has(slot)).length
  const benchSlots = league.roster_positions.filter((slot) => slot === 'BN').length
  const taxiSlots = Number(league.settings.taxi_slots ?? 0)
  const reserveSlots = Number(league.settings.reserve_slots ?? 0)
  const rookieDraftRounds = preset.leagueType === 'dynasty' ? Number(league.settings.draft_rounds ?? 0) : 0
  const redraftRounds = preset.leagueType === 'keeper-redraft'
    ? Number(bundle.draft?.settings?.rounds ?? league.roster_positions.length)
    : 0
  const contextKey = [
    league.league_id,
    `${numTeams}t`,
    `${numQbs}qb`,
    `ppr${receptionPpr}`,
    `tep${tePremiumPerReception}`,
    `start${startingSlots}`,
    `bench${benchSlots}`,
    `taxi${taxiSlots}`,
    `ir${reserveSlots}`,
    `draft${rookieDraftRounds}`,
    `redraft${redraftRounds}`,
  ].join(':')

  return {
    id: league.league_id,
    leagueType: preset.leagueType,
    label: preset.label,
    leagueName: league.name,
    contextKey,
    marketFormat: { numQbs, tep: tePremiumPerReception > 0, numTeams },
    scoring: { receptionPpr, tePremiumPerReception, passingTd, passingInterception },
    roster: { startingSlots, skillStartingSlots, benchSlots, taxiSlots, reserveSlots, rookieDraftRounds },
    labels: {
      format: `${numTeams}-team ${numQbs === 2 ? 'superflex' : '1QB'} · ${receptionPpr}-PPR · +${tePremiumPerReception} TE premium`,
      roster: preset.leagueType === 'keeper-redraft'
        ? `${skillStartingSlots} skill starters · ${benchSlots} bench · ${redraftRounds}-round seasonal draft`
        : `${skillStartingSlots} modeled skill starters · ${benchSlots} bench · ${taxiSlots} taxi · ${rookieDraftRounds}-round rookie draft`,
      market: preset.leagueType === 'keeper-redraft'
        ? `${numQbs === 2 ? 'Superflex' : '1QB'} current-season redraft provider bucket`
        : `${numQbs === 2 ? 'Superflex' : '1QB'} ${tePremiumPerReception > 0 ? 'TEP+' : 'non-TEP'} provider bucket`,
      projection: `Generic PPR forecast + ${tePremiumPerReception} points per observed TE reception/team week`,
    },
  }
}

export function marketTapeLeagueContext(context: LeagueContext): MarketTapeLeagueContext {
  return {
    leagueId: context.id,
    contextKey: context.contextKey,
    receptionPpr: context.scoring.receptionPpr,
    tePremiumPerReception: context.scoring.tePremiumPerReception,
    startingSlots: context.roster.startingSlots,
    skillStartingSlots: context.roster.skillStartingSlots,
    benchSlots: context.roster.benchSlots,
    taxiSlots: context.roster.taxiSlots,
    reserveSlots: context.roster.reserveSlots,
    rookieDraftRounds: context.roster.rookieDraftRounds,
  }
}

/** The trained target remains generic PPR. Only the exact TE reception bonus is
 * added here, using the same per-team-week reception evidence as the model. */
export function projectionForLeague(projection: PlayerProjection, context: LeagueContext): PlayerProjection {
  const receptions = projection.receptionsPerTeamWeek
  const canAdjust = projection.position === 'TE' && Number.isFinite(receptions)
  const adjustment = canAdjust
    ? Number((Number(receptions) * context.scoring.tePremiumPerReception).toFixed(2))
    : 0
  if (!canAdjust || adjustment === 0) return { ...projection, leagueAdjustmentPpg: 0, leagueAdjusted: projection.position !== 'TE' || context.scoring.tePremiumPerReception === 0 }
  const add = (value: number | undefined) => value === undefined ? undefined : Number((value + adjustment).toFixed(1))
  return {
    ...projection,
    expectedPpg: add(projection.expectedPpg)!,
    floorPpg: add(projection.floorPpg)!,
    ceilingPpg: add(projection.ceilingPpg)!,
    restOfSeasonPpg: add(projection.restOfSeasonPpg),
    leagueAdjustmentPpg: adjustment,
    leagueAdjusted: true,
    drivers: [
      ...(projection.drivers ?? []),
      `+${adjustment.toFixed(1)} PPG from ${context.scoring.tePremiumPerReception} TEP and observed reception rate`,
    ].slice(0, 4),
  }
}
