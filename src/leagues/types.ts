import type { TeamStrategyProfile } from '../types'

export type ProtectedAssetPolicy = {
  label: string
  year: number
  round: number
  slot?: number
  until: string
}

type LeagueStrategyProfileBase = {
  leagueId: string
  rosterId: number
  label: string
  objective: string
  protectedAssets: ProtectedAssetPolicy[]
}

export type PowerClimbStrategyProfile = LeagueStrategyProfileBase & {
  kind: 'power-climb'
  targetRank: number
  playoffRank: number
  minimumMeaningfulPowerGain: number
  idealPowerGain: number
  reassessAfterWeek: number
  decisionGates: Array<{
    ranks: [number, number]
    action: string
  }>
}

export type ValueBuildStrategyProfile = LeagueStrategyProfileBase & {
  kind: 'value-build'
  playoffRank: number
  targetRanks: {
    currentSeasonPower: number
    dynastyStarters: number
  }
  declaredStrategy: TeamStrategyProfile
  tradeGuard: {
    rejectTripleLoss: boolean
    reviewMarketLoss: boolean
    verifyRoleWhenPayingPremium: boolean
  }
}

export type LeagueStrategyProfile = PowerClimbStrategyProfile | ValueBuildStrategyProfile
