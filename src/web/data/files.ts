import type { MonthDto } from '../../shared/api'
import { api } from '../api'
import { monthTitle } from '../month/format'

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const today = () => new Date().toISOString().slice(0, 10)

interface BackupFile {
  data: {
    plans: { id: string; name: string; direction: string; kind: string; amount: number; day_of_month: number; start_month: string; installment_count: number | null; end_month: string | null; auto_pay: number; variable: number; closed_at: number | null; deleted_at: number | null }[]
    entries: { month: string; deleted_at: number | null }[]
  }
}

export async function downloadBackup() {
  const backup = await api<unknown>('/export')
  saveBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `hesapp-yedek-${today()}.json`)
}

/** Yedek dosyasını boş veritabanına geri yükler. */
export async function restoreBackup(file: File, replace = false) {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('dosya geçerli bir JSON değil')
  }
  return api<{ plans: number; entries: number; months: number }>(`/import${replace ? '?replace=1' : ''}`, { body: parsed })
}

const lira = (kurus: number) => kurus / 100
const MONEY_FORMAT = '#,##0.00'

/** Her ay bir sayfa (açılış, gelirler, giderler, kapanış) ve bir "Planlar" sayfası. Tarayıcıda üretilir. */
export async function downloadExcel() {
  const [{ default: ExcelJS }, backup] = await Promise.all([import('exceljs'), api<BackupFile>('/export')])
  const months = [...new Set(backup.data.entries.filter((e) => e.deleted_at === null).map((e) => e.month))].sort()
  const loaded: MonthDto[] = []
  for (let i = 0; i < months.length; i += 6) loaded.push(...(await Promise.all(months.slice(i, i + 6).map((m) => api<MonthDto>(`/months/${m}`)))))

  const book = new ExcelJS.Workbook()
  book.creator = 'hesapp'
  for (const data of loaded) {
    const sheet = book.addWorksheet(monthTitle(data.month))
    sheet.columns = [{ width: 34 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 10 }]
    const bold = (row: import('exceljs').Row) => { row.font = { bold: true } }
    bold(sheet.addRow([`${monthTitle(data.month)} (${data.start} – ${data.end})`]))
    sheet.addRow(['Açılış (devir)', '', lira(data.opening.amount)])
    for (const [title, direction] of [['Gelirler', 'income'], ['Giderler', 'expense']] as const) {
      sheet.addRow([])
      bold(sheet.addRow([title, 'Vade', 'Planlanan', 'Gerçekleşen', 'Ödendi']))
      for (const e of data.entries.filter((x) => x.direction === direction)) {
        sheet.addRow([e.name, e.dueDate ?? '', lira(e.plannedAmount), e.actualAmount === null ? '' : lira(e.actualAmount), e.paid ? 'evet' : ''])
      }
      bold(sheet.addRow([`Toplam ${title.toLowerCase()}`, '', lira(direction === 'income' ? data.totals.income : data.totals.expense)]))
    }
    sheet.addRow([])
    bold(sheet.addRow([data.status === 'closed' ? 'Kapanış (banka bakiyesi)' : 'Kapanış (beklenen)', '', lira(data.status === 'closed' ? (data.closingBalance ?? 0) : data.totals.expectedClosing)]))
    sheet.eachRow((row) => [3, 4].forEach((c) => { if (typeof row.getCell(c).value === 'number') row.getCell(c).numFmt = MONEY_FORMAT }))
  }

  const plans = book.addWorksheet('Planlar')
  plans.columns = [{ width: 32 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 8 }, { width: 14 }, { width: 14 }, { width: 10 }]
  plans.addRow(['Ad', 'Yön', 'Tür', 'Tutar', 'Gün', 'İlk ay', 'Taksit sayısı', 'Durum']).font = { bold: true }
  for (const p of backup.data.plans.filter((x) => x.deleted_at === null)) {
    plans.addRow([p.name, p.direction === 'income' ? 'gelir' : 'gider', p.kind === 'installment' ? 'taksitli' : 'her ay', lira(p.amount), p.day_of_month, p.start_month, p.installment_count ?? '', p.closed_at ? 'kapalı' : 'açık']).getCell(4).numFmt = MONEY_FORMAT
  }
  if (loaded.length === 0) book.addWorksheet('Boş').addRow(['Henüz kayıt yok'])

  const buffer = await book.xlsx.writeBuffer()
  saveBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `hesapp-${today()}.xlsx`)
}

/** Tüm bütçe verisini siler (planlar, kayıtlar, aylar, geçmiş). */
export const wipeData = () => api<{ plans: number; entries: number; months: number }>('/data/wipe', { body: { confirm: true } })
