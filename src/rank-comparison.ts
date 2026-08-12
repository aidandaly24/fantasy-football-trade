import type { Team } from './types'

export type TeamRankComparison = {
  marketRank: number
  powerRank: number
  powerGap: number
}

type RankableTeam = Pick<Team, 'rosterId' | 'metrics'>

function ranksBy(teams: RankableTeam[], metric: 'overall' | 'contender') {
  const sorted = [...teams].sort((a, b) => {
    const scoreDifference = b.metrics[metric] - a.metrics[metric]
    return scoreDifference || a.rosterId - b.rosterId
  })

  const ranks = new Map<number, number>()
  let currentRank = 0
  let previousScore: number | undefined

  sorted.forEach((team, index) => {
    const score = team.metrics[metric]
    if (previousScore === undefined || score !== previousScore) currentRank = index + 1
    ranks.set(team.rosterId, currentRank)
    previousScore = score
  })

  return ranks
}

export function buildTeamRankComparisons(teams: RankableTeam[]) {
  const marketRanks = ranksBy(teams, 'overall')
  const powerRanks = ranksBy(teams, 'contender')
  const comparisons = new Map<number, TeamRankComparison>()

  teams.forEach((team) => {
    const marketRank = marketRanks.get(team.rosterId) ?? teams.length
    const powerRank = powerRanks.get(team.rosterId) ?? teams.length
    comparisons.set(team.rosterId, {
      marketRank,
      powerRank,
      powerGap: powerRank - marketRank,
    })
  })

  return comparisons
}
