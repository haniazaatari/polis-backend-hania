export const getGacThresholdByGroupCount = (numGroups: number): number => {
  const thresholds: Record<number, number> = {
    2: 0.7,
    3: 0.47,
    4: 0.32,
    5: 0.24,
  };
  return thresholds[numGroups] ?? 0.24;
};
