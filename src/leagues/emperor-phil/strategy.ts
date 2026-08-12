import type { LeagueStrategyProfile } from '../types'

export const EMPEROR_PHIL_LEAGUE_ID = '1312112570039037952'

/** A private decision policy for Aidan's roster in Emperor Phil. The numbers
 * are declared goals, not learned thresholds or generic fantasy advice. */
export const emperorPhilStrategy: LeagueStrategyProfile = {
  leagueId: EMPEROR_PHIL_LEAGUE_ID,
  rosterId: 5,
  label: 'Patient consolidation',
  objective: 'Move current-season starting-lineup power from the bottom tier into the top six without shortening the 2027–29 window.',
  targetRank: 6,
  playoffRank: 7,
  minimumMeaningfulPowerGain: 250,
  idealPowerGain: 350,
  reassessAfterWeek: 4,
  protectedAssets: [
    { year: 2027, round: 1, until: 'the Week 4 contender gate is passed' },
  ],
  decisionGates: [
    { ranks: [1, 6], action: 'Buy one established difference-maker and make a title push.' },
    { ranks: [7, 9], action: 'Hold unless a discounted consolidation move clears the power threshold.' },
    { ranks: [10, 12], action: 'Protect the first and consider selling older secondary pieces.' },
  ],
}
