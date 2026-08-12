export type LeagueStrategyProfile = {
  leagueId: string
  rosterId: number
  label: string
  objective: string
  targetRank: number
  playoffRank: number
  minimumMeaningfulPowerGain: number
  idealPowerGain: number
  reassessAfterWeek: number
  protectedAssets: Array<{
    year: number
    round: number
    until: string
  }>
  decisionGates: Array<{
    ranks: [number, number]
    action: string
  }>
}
