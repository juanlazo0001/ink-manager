// Estimate prices are Float dollars (deliberate legacy); gift cards store
// integer cents. Every dollars-to-cents conversion goes through here so
// there's exactly one place rounding behavior lives.
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}
