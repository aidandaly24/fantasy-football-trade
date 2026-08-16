export const FREAKBULL_KEEPER_RULE = {
  protectedKeepers: 1,
  wheelCandidates: 3,
  wheelCuts: 1,
} as const

export function keeperRetentionProbability(lane: 'protected' | 'wheel'): number {
  if (lane === 'protected') return 1
  return (FREAKBULL_KEEPER_RULE.wheelCandidates - FREAKBULL_KEEPER_RULE.wheelCuts)
    / FREAKBULL_KEEPER_RULE.wheelCandidates
}

export function totalFreakbullKeepers(): number {
  return FREAKBULL_KEEPER_RULE.protectedKeepers
    + FREAKBULL_KEEPER_RULE.wheelCandidates
    - FREAKBULL_KEEPER_RULE.wheelCuts
}
