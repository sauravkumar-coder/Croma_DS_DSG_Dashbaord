// Croma raw sheet column mapping to StoreRecord fields
export const CROMA_XLSX_MAPPINGS = {
  store_id: 'Branch_ Code',
  store_name: 'Store Branch',
  state: 'State',
  category: 'Device Category',
  plan_category: 'Plan_Category',
  amount: 'Amount',
  month: 'Month',
  date: 'Date',
} as const;

export type CromaXlsxMapping = typeof CROMA_XLSX_MAPPINGS;
