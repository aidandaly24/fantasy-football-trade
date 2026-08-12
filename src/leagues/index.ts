import { EMPEROR_PHIL_LEAGUE_ID, emperorPhilStrategy } from './emperor-phil/strategy'
import type { LeagueStrategyProfile } from './types'

export function strategyProfileForLeague(
  leagueId: string,
  rosterId: number,
): LeagueStrategyProfile | null {
  if (leagueId === EMPEROR_PHIL_LEAGUE_ID && rosterId === emperorPhilStrategy.rosterId) {
    return emperorPhilStrategy
  }
  return null
}

export type { LeagueStrategyProfile } from './types'
