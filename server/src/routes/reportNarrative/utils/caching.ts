export const isFreshData = (timestamp: string): boolean => {
  const now = new Date().getTime();
  const then = new Date(timestamp).getTime();
  const elapsed = Math.abs(now - then);
  return (
    elapsed <
    (((process.env.MAX_REPORT_CACHE_DURATION as unknown) as number) || 3600000)
  );
};
