import type { StoreRecord } from '@/lib/api';

/**
 * Derived metrics helper for Croma.
 * Since SP maps to primary (DS) and ADLD/Combo to secondary (DSG),
 * this helper computes metrics specifically for Croma's terminology if needed.
 */
export function getCromaMetrics(store: StoreRecord) {
  const totalSales = Object.values(store.monthly_sales).reduce((a, b) => a + b, 0);
  const spSales = store.monthly_sales_ds 
    ? Object.values(store.monthly_sales_ds).reduce((a, b) => a + b, 0)
    : 0;
  const adldSales = store.monthly_sales_dsg
    ? Object.values(store.monthly_sales_dsg).reduce((a, b) => a + b, 0)
    : 0;

  return {
    totalSales,
    spSales,
    adldSales,
    spPercentage: totalSales > 0 ? (spSales / totalSales) * 100 : 0,
    adldPercentage: totalSales > 0 ? (adldSales / totalSales) * 100 : 0,
  };
}
