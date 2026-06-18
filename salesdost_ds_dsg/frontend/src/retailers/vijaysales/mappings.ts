// Vijay Sales raw sheet column mapping to StoreRecord fields
export const VS_XLSX_MAPPINGS = {
  store_id: 'Branch',
  store_name: 'Branch',
  state: 'Spoc State Name',
  category: 'Device Category',
  plan_category: 'Plan_Category',
  amount: 'Amount',
  month: 'Month',
  date: 'Date',
} as const;

export type VsXlsxMapping = typeof VS_XLSX_MAPPINGS;
