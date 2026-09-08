export function resizePane(
  current: number,
  delta: number,
  minimum: number,
  maximum: number,
  direction: 1 | -1 = 1
): number {
  return Math.max(minimum, Math.min(maximum, current + direction * delta));
}
