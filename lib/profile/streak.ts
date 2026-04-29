export function resolveStreakForDisplay(input: {
  storedCurrent: number;
  storedLongest: number;
  derivedCurrent: number;
  derivedLongest: number;
}): { current: number; longest: number } {
  const current =
    input.storedCurrent > 0 ? input.storedCurrent : input.derivedCurrent;
  const longest =
    input.storedLongest > 0 ? input.storedLongest : input.derivedLongest;
  return { current, longest };
}
