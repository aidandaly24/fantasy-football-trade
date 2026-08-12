import { BC_LEAGUE_ID, bcStrategy } from './bc/strategy'
import { EMPEROR_PHIL_LEAGUE_ID, emperorPhilStrategy } from './emperor-phil/strategy'
import type { LeagueStrategyProfile } from './types'

export function strategyProfileForLeague(
  leagueId: string,
  rosterId: number,
): LeagueStrategyProfile | null {
  if (leagueId === BC_LEAGUE_ID && rosterId === bcStrategy.rosterId) {
    return bcStrategy
  }
  if (leagueId === EMPEROR_PHIL_LEAGUE_ID && rosterId === emperorPhilStrategy.rosterId) {
    return emperorPhilStrategy
  }
  return null
}

export type { LeagueStrategyProfile } from './types'
export { evaluateLeagueTradePolicy } from './trade-policy'
export type { LeagueTradePolicyDecision, LeagueTradePolicyFacts } from './trade-policy'
