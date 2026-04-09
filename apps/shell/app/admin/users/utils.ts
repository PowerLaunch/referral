export function riskColor(score: number): string {
  if (score >= 61) return 'text-red-600 font-bold'
  if (score >= 31) return 'text-yellow-600 font-semibold'
  return 'text-green-600'
}
