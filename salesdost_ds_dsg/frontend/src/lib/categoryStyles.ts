import type { StoreCategory } from './classificationEngine'

/**
 * Tailwind text-colour class for each store category.
 *
 * Used in table cells and inline labels to colour the category name
 * consistently across tabs (Rising Stars, Fallen Stars, Store Journeys, etc.).
 * Add or update a colour here and it propagates everywhere automatically.
 */
export const CATEGORY_TEXT_COLOR: Record<StoreCategory, string> = {
  'New Bloomer':    'text-emerald-600',
  'Rising Star':    'text-yellow-500',
  'Growing Store':  'text-blue-500',
  'Constant Store': 'text-violet-500',
  'Declining Store':'text-orange-500',
  'Fallen Star':    'text-red-600',
  'Inactive Store': 'text-gray-400',
}
