export type IntelEventType =
  | 'injury'
  | 'role'
  | 'transaction'
  | 'contract'
  | 'suspension'
  | 'performance'
  | 'general'

export type EventDirection = 'up' | 'down' | 'watch'

export type EventClassification = {
  eventType: IntelEventType
  direction: EventDirection
  impactWeight: number
  expiresInHours: number
}

const RULES: Array<{
  eventType: IntelEventType
  direction: EventDirection
  impactWeight: number
  expiresInHours: number
  pattern: RegExp
}> = [
  { eventType: 'suspension', direction: 'down', impactWeight: 0.95, expiresInHours: 168, pattern: /\b(suspend(?:ed|sion)?|banned|arrested|disciplin(?:e|ed|es))\b/i },
  { eventType: 'injury', direction: 'up', impactWeight: 0.82, expiresInHours: 72, pattern: /\b(activated|cleared|full participant|returns? to practice|healthy|off pup|off ir)\b/i },
  { eventType: 'injury', direction: 'down', impactWeight: 1, expiresInHours: 96, pattern: /\b(torn|surgery|injur(?:y|ed)|placed on ir|ruled out|expected to miss|setback|fracture|questionable|doubtful)\b/i },
  { eventType: 'role', direction: 'down', impactWeight: 0.82, expiresInHours: 72, pattern: /\b(demoted|benched|loses? starting job|second[- ]team|backup role)\b/i },
  { eventType: 'role', direction: 'up', impactWeight: 0.88, expiresInHours: 72, pattern: /\b(named starter|first[- ]team|promoted|wins? starting job|depth chart|expanded role)\b/i },
  { eventType: 'transaction', direction: 'down', impactWeight: 0.72, expiresInHours: 168, pattern: /\b(released|waiv(?:ed|es)|cut by)\b/i },
  { eventType: 'transaction', direction: 'watch', impactWeight: 0.78, expiresInHours: 168, pattern: /\b(traded|trade(?:d)? to|signs? with|claimed by|acquired)\b/i },
  { eventType: 'contract', direction: 'up', impactWeight: 0.62, expiresInHours: 168, pattern: /\b(extension|new contract|agrees? to terms|restructured)\b/i },
  { eventType: 'contract', direction: 'down', impactWeight: 0.7, expiresInHours: 120, pattern: /\b(holdout|holds? out|contract dispute)\b/i },
  { eventType: 'performance', direction: 'up', impactWeight: 0.5, expiresInHours: 36, pattern: /\b(impresses|standout|breakout|sharp|dominates|strong practice)\b/i },
  { eventType: 'performance', direction: 'down', impactWeight: 0.5, expiresInHours: 36, pattern: /\b(struggles|shaky|throws? .* picks?|fumbles|poor practice)\b/i },
]

export function normalizeHeadline(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(update|report|breaking|nfl news|latest)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function classifyHeadline(title: string): EventClassification {
  const normalized = normalizeHeadline(title)
  const rule = RULES.find((candidate) => candidate.pattern.test(normalized))
  if (!rule) return { eventType: 'general', direction: 'watch', impactWeight: 0.25, expiresInHours: 24 }
  return {
    eventType: rule.eventType,
    direction: rule.direction,
    impactWeight: rule.impactWeight,
    expiresInHours: rule.expiresInHours,
  }
}

function tokens(value: string): Set<string> {
  return new Set(normalizeHeadline(value).split(' ').filter((token) => token.length > 2))
}

export function headlineSimilarity(left: string, right: string): number {
  const a = tokens(left)
  const b = tokens(right)
  if (!a.size || !b.size) return 0
  const intersection = [...a].filter((token) => b.has(token)).length
  return intersection / new Set([...a, ...b]).size
}

export const CLASSIFIER_FIXTURES: Array<{
  title: string
  eventType: IntelEventType
  direction: EventDirection
}> = [
  { title: 'Joe Burrow cleared for full practice', eventType: 'injury', direction: 'up' },
  { title: 'Tee Higgins expected to miss two weeks with injury', eventType: 'injury', direction: 'down' },
  { title: 'Rookie named starter after strong camp', eventType: 'role', direction: 'up' },
  { title: 'Veteran benched and moved to backup role', eventType: 'role', direction: 'down' },
  { title: 'Receiver traded to Buffalo', eventType: 'transaction', direction: 'watch' },
  { title: 'Running back released by Chicago', eventType: 'transaction', direction: 'down' },
  { title: 'Quarterback agrees to contract extension', eventType: 'contract', direction: 'up' },
  { title: 'Star begins holdout amid contract dispute', eventType: 'contract', direction: 'down' },
  { title: 'Player suspended six games', eventType: 'suspension', direction: 'down' },
  { title: 'Wideout impresses during night practice', eventType: 'performance', direction: 'up' },
  { title: 'Quarterback struggles and throws two picks', eventType: 'performance', direction: 'down' },
  { title: 'Team announces regular-season schedule', eventType: 'general', direction: 'watch' },
  { title: 'Back activated from injured reserve', eventType: 'injury', direction: 'up' },
  { title: 'Receiver placed on IR after surgery', eventType: 'injury', direction: 'down' },
  { title: 'Depth chart lists rookie with first team', eventType: 'role', direction: 'up' },
  { title: 'Former starter demoted to second-team offense', eventType: 'role', direction: 'down' },
  { title: 'Free agent signs with Minnesota', eventType: 'transaction', direction: 'watch' },
  { title: 'Team waives veteran tight end', eventType: 'transaction', direction: 'down' },
  { title: 'Young receiver dominates joint practice', eventType: 'performance', direction: 'up' },
  { title: 'League disciplines player after review', eventType: 'suspension', direction: 'down' },
]

export function classifierFixtureAccuracy(): number {
  const correct = CLASSIFIER_FIXTURES.filter((fixture) => {
    const result = classifyHeadline(fixture.title)
    return result.eventType === fixture.eventType && result.direction === fixture.direction
  }).length
  return correct / CLASSIFIER_FIXTURES.length
}
