import type { StoreRecord } from './api'
import { classifyAllStores, type ClassificationResult } from './classificationEngine'

/**
 * Return all plan categories that have active sales for this store.
 */
export function getStorePlanCategories(store: StoreRecord): string {
  const hasDS = store.monthly_sales_ds && Object.values(store.monthly_sales_ds).some(v => v > 0);
  const hasDSG = store.monthly_sales_dsg && Object.values(store.monthly_sales_dsg).some(v => v > 0);
  if (hasDS && hasDSG) return "SP, DSG";
  if (hasDS) return "SP";
  if (hasDSG) return "DSG";
  return "—";
}

/**
 * Transforms each store record to represent only the selected plan category's sales.
 */
export function transformStoresByPlanCategory(stores: StoreRecord[], planCategory: string): StoreRecord[] {
  if (!planCategory) return stores;
  
  const isDS = planCategory === 'SP';
  const isDSG = ['ADLD', 'Combo', 'EW'].includes(planCategory);
  
  return stores
    .map(s => {
      let monthlySales: Record<string, number> = {};
      if (isDS) {
        monthlySales = s.monthly_sales_ds || {};
      } else if (isDSG) {
        monthlySales = s.monthly_sales_dsg || {};
      } else {
        monthlySales = s.monthly_sales || {};
      }
      
      const totalSales = Object.values(monthlySales).reduce((sum, v) => sum + v, 0);
      return {
        ...s,
        monthly_sales: monthlySales,
        total_sales: totalSales,
      };
    })
    .filter(s => {
      // Filter out stores that have zero sales in the selected plan category
      return Object.values(s.monthly_sales).some(v => v > 0);
    });
}

/**
 * Helper to compute dynamic classification metrics on stores filtered by plan category.
 */
export function getTabClassification(
  stores: StoreRecord[],
  months: string[],
  planCategory: string
): ClassificationResult {
  const transformed = transformStoresByPlanCategory(stores, planCategory);
  return classifyAllStores(transformed, months);
}
