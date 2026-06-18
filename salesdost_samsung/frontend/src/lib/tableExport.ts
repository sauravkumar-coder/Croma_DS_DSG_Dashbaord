import * as XLSX from 'xlsx'

type CellValue = string | number | null | undefined

export function exportCsv(
  filename: string,
  headers: string[],
  rows: CellValue[][],
): void {
  const encode = (v: CellValue): string => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const content = [headers, ...rows]
    .map(row => row.map(encode).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, ensureExt(filename, '.csv'))
}

export function exportExcel(
  filename: string,
  headers: string[],
  rows: CellValue[][],
): void {
  const aoa = [headers, ...rows.map(r => r.map(v => v ?? ''))]
  const ws  = XLSX.utils.aoa_to_sheet(aoa)
  const wb  = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Data')
  XLSX.writeFile(wb, ensureExt(filename, '.xlsx'))
}

function ensureExt(name: string, ext: string): string {
  return name.endsWith(ext) ? name : name + ext
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
