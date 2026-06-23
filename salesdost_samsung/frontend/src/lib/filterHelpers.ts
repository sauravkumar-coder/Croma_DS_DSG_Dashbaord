import type { StoreRecord } from './api'
import { classifyAllStores, type ClassificationResult } from './classificationEngine'

export function getStorePlanCategories(store: StoreRecord): string {
  const categories: string[] = [];
  if (store.monthly_sales_sp && Object.values(store.monthly_sales_sp).some(v => v > 0)) {
    categories.push("SP");
  }
  if (store.monthly_sales_adld && Object.values(store.monthly_sales_adld).some(v => v > 0)) {
    categories.push("ADLD");
  }
  if (store.monthly_sales_combo && Object.values(store.monthly_sales_combo).some(v => v > 0)) {
    categories.push("Combo");
  }
  if (store.monthly_sales_ew && Object.values(store.monthly_sales_ew).some(v => v > 0)) {
    categories.push("EW");
  }
  return categories.length > 0 ? categories.join(", ") : "—";
}

/**
 * Transforms each store record to represent only the selected plan category's sales.
 */
export function transformStoresByPlanCategory(stores: StoreRecord[], planCategory: string): StoreRecord[] {
  if (!planCategory) return stores;
  
  return stores
    .map(s => {
      let monthlySales: Record<string, number> = {};
      if (planCategory === 'SP') {
        monthlySales = s.monthly_sales_sp || {};
      } else if (planCategory === 'ADLD') {
        monthlySales = s.monthly_sales_adld || {};
      } else if (planCategory === 'Combo') {
        monthlySales = s.monthly_sales_combo || {};
      } else if (planCategory === 'EW') {
        monthlySales = s.monthly_sales_ew || {};
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
