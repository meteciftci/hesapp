import { z } from 'zod'
import { DATE_PATTERN, MONTH_PATTERN } from '../../shared/month'
import { isDate } from '../../shared/month'

const MAX_KURUS = 9_000_000_000_00

export const kurus = z.number().int().min(0).max(MAX_KURUS)
export const signedKurus = z.number().int().min(-MAX_KURUS).max(MAX_KURUS)
const month = z.string().regex(MONTH_PATTERN, 'ay YYYY-AA biçiminde olmalı')
const date = z.string().regex(DATE_PATTERN, 'tarih YYYY-AA-GG biçiminde olmalı').refine(isDate, 'geçersiz tarih')
const name = z.string().trim().min(1, 'ad gerekli').max(80, 'ad en fazla 80 karakter olabilir')
const note = z.string().trim().max(500, 'not en fazla 500 karakter olabilir')
const direction = z.enum(['income', 'expense'])
export const scope = z.enum(['this', 'following', 'all'])

export const planCreate = z
  .object({
    direction,
    kind: z.enum(['recurring', 'installment']),
    name,
    amount: kurus,
    dayOfMonth: z.number().int().min(1).max(31),
    startMonth: month,
    installmentCount: z.number().int().min(1).max(600).optional(),
    endMonth: month.optional(),
    variable: z.boolean().optional(),
    autoPay: z.boolean().optional(),
    note: note.optional(),
    /** Geçmişe dönük başlayan planda, vadesi geçmiş kayıtları ödendi say */
    markPastPaid: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'installment' && v.installmentCount === undefined) ctx.addIssue({ code: 'custom', path: ['installmentCount'], message: 'taksitli plan için taksit sayısı gerekli' })
    if (v.kind === 'recurring' && v.installmentCount !== undefined) ctx.addIssue({ code: 'custom', path: ['installmentCount'], message: 'tekrarlayan plan taksit sayısı almaz' })
    if (v.kind === 'installment' && v.endMonth !== undefined) ctx.addIssue({ code: 'custom', path: ['endMonth'], message: 'taksitli plan bitiş ayı almaz' })
    if (v.endMonth !== undefined && v.endMonth < v.startMonth) ctx.addIssue({ code: 'custom', path: ['endMonth'], message: 'bitiş ayı başlangıçtan önce olamaz' })
  })

export const entryCreate = z
  .object({
    month,
    direction,
    name,
    plannedAmount: kurus,
    dueDate: date.optional(),
    autoPay: z.boolean().optional(),
    isEstimate: z.boolean().optional(),
    note: note.optional(),
  })
  .strict()

export const entryPatch = z
  .object({
    name: name.optional(),
    plannedAmount: kurus.optional(),
    actualAmount: kurus.nullable().optional(),
    dueDate: date.nullable().optional(),
    isEstimate: z.boolean().optional(),
    autoPay: z.boolean().optional(),
    note: note.nullable().optional(),
    scope: scope.optional(),
  })
  .strict()

export const payBody = z.object({ actualAmount: kurus.optional() }).strict()

export const schedulePaste = z
  .object({
    text: z.string().max(20_000).optional(),
    amounts: z.array(kurus).max(600).optional(),
    startNo: z.number().int().min(1).optional(),
    /** Tutar sayısı kalan taksit sayısıyla uyuşmasa da uygula */
    force: z.boolean().optional(),
    /** Yalnızca ayrıştır ve ne olacağını göster */
    dryRun: z.boolean().optional(),
  })
  .strict()
  .refine((v) => (v.text === undefined) !== (v.amounts === undefined), 'text ya da amounts verilmeli (yalnızca biri)')

export const planClose = z.object({ fromMonth: month, payoffAmount: kurus.optional() }).strict()
export const monthClose = z.object({ bankBalance: signedKurus, name: name.optional() }).strict()
export const monthOpening = z.object({ balance: signedKurus }).strict()
