// ── Retailer Factory ─────────────────────────────────────────────────────────
//
// Central registry for Croma and Vijay Sales retailers.
// Call getRetailerConfig(id) to get branding + API paths anywhere in the app.

import {
  CROMA_RETAILER_ID,
  CROMA_LABEL,
  CROMA_SHORT,
  CROMA_BRAND_FROM,
  CROMA_BRAND_TO,
  CROMA_TAGLINE,
  CROMA_SUB,
  CROMA_FOOTER,
  CROMA_UPLOAD_LABEL,
  CROMA_UPLOAD_HINT,
} from './croma/constants'

import {
  VS_RETAILER_ID,
  VS_LABEL,
  VS_SHORT,
  VS_BRAND_FROM,
  VS_BRAND_TO,
  VS_TAGLINE,
  VS_SUB,
  VS_FOOTER,
  VS_UPLOAD_LABEL,
  VS_UPLOAD_HINT,
} from './vijaysales/constants'

import {
  RELIANCE_RETAILER_ID,
  RELIANCE_LABEL,
  RELIANCE_SHORT,
  RELIANCE_BRAND_FROM,
  RELIANCE_BRAND_TO,
  RELIANCE_TAGLINE,
  RELIANCE_SUB,
  RELIANCE_FOOTER,
  RELIANCE_UPLOAD_LABEL,
  RELIANCE_UPLOAD_HINT,
} from './reliance/constants'

import {
  HOTSPOT_RETAILER_ID,
  HOTSPOT_LABEL,
  HOTSPOT_SHORT,
  HOTSPOT_BRAND_FROM,
  HOTSPOT_BRAND_TO,
  HOTSPOT_TAGLINE,
  HOTSPOT_SUB,
  HOTSPOT_FOOTER,
  HOTSPOT_UPLOAD_LABEL,
  HOTSPOT_UPLOAD_HINT,
} from './hotspot/constants'

export type RetailerId = 'croma' | 'vijaysales' | 'reliance' | 'hotspot'

export interface RetailerConfig {
  id:            RetailerId
  label:         string        // 'Croma' / 'Vijay Sales'
  short:         string        // 'CR' / 'VS'
  brandFrom:     string        // gradient start (hex)
  brandTo:       string        // gradient end (hex)
  tagline:       string        // header title
  sub:           string        // header sub-line
  footer:        string        // footer text
  uploadLabel:   string        // upload zone heading
  uploadHint:    string        // upload zone hint
  apiRetailerId: string        // value for ?retailer= query param
  apiUploadPath: string        // POST /api/upload/sales/…
  apiDeletePath: string        // DELETE /api/storage/sales/…
  apiMetaPath:   string        // GET /api/sales/meta/…
}

const REGISTRY: Record<RetailerId, RetailerConfig> = {
  croma: {
    id:            CROMA_RETAILER_ID as RetailerId,
    label:         CROMA_LABEL,
    short:         CROMA_SHORT,
    brandFrom:     CROMA_BRAND_FROM,
    brandTo:       CROMA_BRAND_TO,
    tagline:       CROMA_TAGLINE,
    sub:           CROMA_SUB,
    footer:        CROMA_FOOTER,
    uploadLabel:   CROMA_UPLOAD_LABEL,
    uploadHint:    CROMA_UPLOAD_HINT,
    apiRetailerId: 'croma',
    apiUploadPath: '/api/upload/sales/croma',
    apiDeletePath: '/api/storage/sales/croma',
    apiMetaPath:   '/api/sales/meta/croma',
  },
  vijaysales: {
    id:            VS_RETAILER_ID as RetailerId,
    label:         VS_LABEL,
    short:         VS_SHORT,
    brandFrom:     VS_BRAND_FROM,
    brandTo:       VS_BRAND_TO,
    tagline:       VS_TAGLINE,
    sub:           VS_SUB,
    footer:        VS_FOOTER,
    uploadLabel:   VS_UPLOAD_LABEL,
    uploadHint:    VS_UPLOAD_HINT,
    apiRetailerId: 'vijaysales',
    apiUploadPath: '/api/upload/sales/vijaysales',
    apiDeletePath: '/api/storage/sales/vijaysales',
    apiMetaPath:   '/api/sales/meta/vijaysales',
  },
  reliance: {
    id:            RELIANCE_RETAILER_ID as RetailerId,
    label:         RELIANCE_LABEL,
    short:         RELIANCE_SHORT,
    brandFrom:     RELIANCE_BRAND_FROM,
    brandTo:       RELIANCE_BRAND_TO,
    tagline:       RELIANCE_TAGLINE,
    sub:           RELIANCE_SUB,
    footer:        RELIANCE_FOOTER,
    uploadLabel:   RELIANCE_UPLOAD_LABEL,
    uploadHint:    RELIANCE_UPLOAD_HINT,
    apiRetailerId: 'reliance',
    apiUploadPath: '/api/upload/sales/reliance',
    apiDeletePath: '/api/storage/sales/reliance',
    apiMetaPath:   '/api/sales/meta/reliance',
  },
  hotspot: {
    id:            HOTSPOT_RETAILER_ID as RetailerId,
    label:         HOTSPOT_LABEL,
    short:         HOTSPOT_SHORT,
    brandFrom:     HOTSPOT_BRAND_FROM,
    brandTo:       HOTSPOT_BRAND_TO,
    tagline:       HOTSPOT_TAGLINE,
    sub:           HOTSPOT_SUB,
    footer:        HOTSPOT_FOOTER,
    uploadLabel:   HOTSPOT_UPLOAD_LABEL,
    uploadHint:    HOTSPOT_UPLOAD_HINT,
    apiRetailerId: 'hotspot',
    apiUploadPath: '/api/upload/sales/hotspot',
    apiDeletePath: '/api/storage/sales/hotspot',
    apiMetaPath:   '/api/sales/meta/hotspot',
  },
}

export const RETAILER_IDS: RetailerId[] = [
  CROMA_RETAILER_ID as RetailerId,
  VS_RETAILER_ID as RetailerId,
  RELIANCE_RETAILER_ID as RetailerId,
  HOTSPOT_RETAILER_ID as RetailerId,
]
export const DEFAULT_RETAILER: RetailerId = 'croma'

export function getRetailerConfig(id: RetailerId): RetailerConfig {
  return REGISTRY[id]
}

export function isValidRetailerId(id: string): id is RetailerId {
  return id === 'croma' || id === 'vijaysales' || id === 'reliance' || id === 'hotspot'
}
