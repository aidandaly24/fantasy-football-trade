import type { ValueBuildStrategyProfile } from '../types'

export const BC_LEAGUE_ID = '1336087922847289344'

/** A private decision policy for Aidan's BC roster. It declares the roster's
 * current value-building phase; it does not modify shared market prices. */
export const bcStrategy: ValueBuildStrategyProfile = {
  kind: 'value-build',
  leagueId: BC_LEAGUE_ID,
  rosterId: 2,
  label: 'Value-first climb',
  objective: 'Build a top-eight starter core and current-season lineup before converting league-leading draft liquidity into a top-six playoff push.',
  playoffRank: 6,
  targetRanks: {
    currentSeasonPower: 8,
    dynastyStarters: 8,
  },
  declaredStrategy: {
    mode: 'rebuilding',
    horizonYears: 3,
    flipPriority: 0,
  },
  protectedAssets: [
    { label: '2026 1.02', year: 2026, round: 1, slot: 2, until: 'the top-eight starter and power gates are both cleared' },
    { label: 'owned 2027 firsts', year: 2027, round: 1, until: 'the top-eight starter and power gates are both cleared' },
  ],
  tradeGuard: {
    rejectTripleLoss: true,
    reviewMarketLoss: true,
    verifyRoleWhenPayingPremium: true,
  },
}
