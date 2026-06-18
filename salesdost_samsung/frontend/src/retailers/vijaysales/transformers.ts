import type { StoreRecord } from '@/lib/api';

/**
 * Derived metrics helper for Vijay Sales.
 * Since SP maps to primary (DS) and ADLD/Combo/EW to secondary (DSG),
 * this helper computes metrics specifically for Vijay Sales' terminology if needed.
 */
export function getVsMetrics(store: StoreRecord) {
  const totalSales = Object.values(store.monthly_sales).reduce((a, b) => a + b, 0);
  const spSales = store.monthly_sales_ds 
    ? Object.values(store.monthly_sales_ds).reduce((a, b) => a + b, 0)
    : 0;
  const adldEwSales = store.monthly_sales_dsg
    ? Object.values(store.monthly_sales_dsg).reduce((a, b) => a + b, 0)
    : 0;

  return {
    totalSales,
    spSales,
    adldEwSales,
    spPercentage: totalSales > 0 ? (spSales / totalSales) * 100 : 0,
    adldEwPercentage: totalSales > 0 ? (adldEwSales / totalSales) * 100 : 0,
  };
}
