export function severityPoints(severity: string): number {
  if (severity === 'CRITICAL') return 50
  if (severity === 'WARNING') return 30
  return 10
}
