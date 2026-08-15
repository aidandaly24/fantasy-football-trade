import type { LeagueBundle, SleeperDraftPick, TradyrPlayer } from './types'

export type DraftPickWindow = {
  round: number
  overallPick: number
  draftSlot: number
}

export type StarterDemand = {
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX'
  perTeam: number
  leagueWide: number
  note: string
}

export type RedraftDraftPlan = {
  draftStatus: string
  draftType: string
  draftSlot: number | null
  teamCount: number
  rounds: number
  recordedPicks: number
  keeperLimit: number
  myKeepers: number
  leagueKeepers: number
  pickWindows: DraftPickWindow[]
  starterDemand: StarterDemand[]
  strategyRules: string[]
}

const CORE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

function draftSlotForRoster(bundle: LeagueBundle, rosterId: number | null): number | null {
  if (!bundle.draft || rosterId === null) return null
  const direct = Object.entries(bundle.draft.slot_to_roster_id ?? {})
    .find(([, mappedRosterId]) => Number(mappedRosterId) === rosterId)?.[0]
  if (direct) return Number(direct)

  const ownerId = bundle.rosters.find((roster) => roster.roster_id === rosterId)?.owner_id
  const ordered = ownerId ? bundle.draft.draft_order?.[ownerId] : undefined
  return Number.isFinite(Number(ordered)) ? Number(ordered) : null
}

export function snakeOverallPick(round: number, draftSlot: number, teamCount: number): number {
  const slotInRound = round % 2 === 1 ? draftSlot : teamCount - draftSlot + 1
  return (round - 1) * teamCount + slotInRound
}

export function buildRedraftDraftPlan(bundle: LeagueBundle, myRosterId: number | null): RedraftDraftPlan {
  const { league, draft } = bundle
  const teamCount = Number(draft?.settings?.teams ?? league.total_rosters)
  const rounds = Number(draft?.settings?.rounds ?? league.roster_positions.length)
  const draftSlot = draftSlotForRoster(bundle, myRosterId)
  const keeperLimit = Number(league.settings.max_keepers ?? 0)
  const myKeepers = bundle.rosters.find((roster) => roster.roster_id === myRosterId)?.keepers?.length ?? 0
  const leagueKeepers = bundle.rosters.reduce((total, roster) => total + (roster.keepers?.length ?? 0), 0)
  const flexCount = league.roster_positions.filter((position) => position === 'FLEX').length
  const starterDemand: StarterDemand[] = CORE_POSITIONS.map((position) => {
    const perTeam = league.roster_positions.filter((slot) => slot === position).length
    return {
      position,
      perTeam,
      leagueWide: perTeam * teamCount,
      note: `${perTeam * teamCount} fixed ${position} starts before flex allocation.`,
    }
  })
  if (flexCount > 0) {
    starterDemand.push({
      position: 'FLEX',
      perTeam: flexCount,
      leagueWide: flexCount * teamCount,
      note: `${flexCount * teamCount} additional RB/WR/TE starts compete for the same player pool.`,
    })
  }

  const strategyRules = [
    `${league.scoring_settings.rec ?? 0}-PPR and ${flexCount} flex spots reward repeatable target and touch volume at RB/WR.`,
    `${league.scoring_settings.pass_td ?? 4}-point passing touchdowns raise quarterback scoring, but a ${teamCount}-team 1QB pool keeps replacement depth available.`,
    `${league.roster_positions.filter((position) => position === 'BN').length} bench spots favor usable upside and waiver flexibility over low-ceiling backups.`,
  ]
  const specialSlots = league.roster_positions.filter((position) => position === 'K' || position === 'DEF')
  if (specialSlots.length === 0) strategyRules.push('No kicker or defense slots: every draft pick can be allocated to QB, RB, WR, or TE.')

  return {
    draftStatus: draft?.status ?? league.status,
    draftType: draft?.type ?? 'unknown',
    draftSlot,
    teamCount,
    rounds,
    recordedPicks: bundle.draftPicks.length,
    keeperLimit,
    myKeepers,
    leagueKeepers,
    pickWindows: draftSlot === null
      ? []
      : Array.from({ length: Math.min(6, rounds) }, (_, index) => ({
          round: index + 1,
          draftSlot,
          overallPick: snakeOverallPick(index + 1, draftSlot, teamCount),
        })),
    starterDemand,
    strategyRules,
  }
}

export function availableRedraftBoard(
  players: TradyrPlayer[],
  picks: SleeperDraftPick[],
  limit = 30,
): TradyrPlayer[] {
  const drafted = new Set(picks.map((pick) => pick.player_id))
  return players
    .filter((player) => player.sleeperId && !drafted.has(player.sleeperId))
    .sort((left, right) => {
      const leftRank = left.rank > 0 ? left.rank : Number.POSITIVE_INFINITY
      const rightRank = right.rank > 0 ? right.rank : Number.POSITIVE_INFINITY
      return leftRank - rightRank || right.composite - left.composite || left.name.localeCompare(right.name)
    })
    .slice(0, limit)
}
