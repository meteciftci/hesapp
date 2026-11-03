import { z } from 'zod'
import { DATE_PATTERN, isDate, MONTH_PATTERN } from '../../shared/month'
import { MAX_START_DAY, MIN_START_DAY } from '../../shared/period'

const MAX_KURUS = 9_000_000_000_00

export const kurus = z.number().int().min(0).max(MAX_KURUS)
export const signedKurus = z.number().int().min(-MAX_KURUS).max(MAX_KURUS)
const month = z.string().regex(MONTH_PATTERN, 'ay YYYY-AA biçiminde olmalı')
const date = z.string().regex(DATE_PATTERN, 'tarih YYYY-AA-GG biçiminde olmalı').refine(isDate, 'geçersiz tarih')
const name = z.string().trim().min(1, 'ad gerekli').max(80, 'ad en fazla 80 karakter olabilir')
const note = z.string().trim().max(500, 'not en fazla 500 karakter olabilir')
const direction = z.enum(['income', 'expense'])
export const scope = z.enum(['this', 'following', 'all'])
const categoryId = z.string().min(1).max(64).nullable().optional()

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
    /** Kredi kartı: tutarı her ay değişen tekrarlayan gider (tahmini doğar) */
    card: z.boolean().optional(),
    autoPay: z.boolean().optional(),
    note: note.optional(),
    categoryId,
    /** Geçmişe dönük başlayan planda, vadesi geçmiş kayıtları ödendi say */
    markPastPaid: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'installment' && v.installmentCount === undefined) ctx.addIssue({ code: 'custom', path: ['installmentCount'], message: 'taksitli plan için taksit sayısı gerekli' })
    if (v.kind === 'recurring' && v.installmentCount !== undefined) ctx.addIssue({ code: 'custom', path: ['installmentCount'], message: 'tekrarlayan plan taksit sayısı almaz' })
    if (v.kind === 'installment' && v.endMonth !== undefined) ctx.addIssue({ code: 'custom', path: ['endMonth'], message: 'taksitli plan bitiş ayı almaz' })
    if (v.card && (v.kind !== 'recurring' || v.direction !== 'expense')) ctx.addIssue({ code: 'custom', path: ['card'], message: 'kredi kartı her ay tekrarlayan bir giderdir' })
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
    categoryId,
  })
  .strict()

/** İçe aktarma sihirbazı: tek istekte en çok 500 tek seferlik kayıt. */
export const entryBulk = z.object({ entries: z.array(entryCreate).min(1, 'kayıt yok').max(500, 'tek seferde en çok 500 kayıt') }).strict()

export const entryPatch = z
  .object({
    name: name.optional(),
    plannedAmount: kurus.optional(),
    actualAmount: kurus.nullable().optional(),
    dueDate: date.nullable().optional(),
    isEstimate: z.boolean().optional(),
    autoPay: z.boolean().optional(),
    note: note.nullable().optional(),
    categoryId,
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

export const planEstimate = z.object({ amount: kurus }).strict()
export const planClose = z.object({ fromMonth: month, payoffAmount: kurus.optional() }).strict()
export const monthClose = z.object({ bankBalance: signedKurus, name: name.optional() }).strict()
export const monthSync = z.object({ bankBalance: signedKurus }).strict()
export const monthOpening = z.object({ balance: signedKurus }).strict()
export const settingsUpdate = z.object({ periodStartDay: z.number().int().min(MIN_START_DAY, 'başlangıç günü 1–28 arasında olmalı').max(MAX_START_DAY, 'başlangıç günü 1–28 arasında olmalı') }).strict()

const installmentFields = {
  installmentNo: z.number().int().min(1).max(600).nullable().optional(),
  installmentCount: z.number().int().min(1).max(600).nullable().optional(),
}

export const itemCreate = z
  .object({ name, amount: kurus, date: date.optional(), ...installmentFields })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.installmentNo ?? null) === null !== ((v.installmentCount ?? null) === null)) ctx.addIssue({ code: 'custom', path: ['installmentCount'], message: 'taksit için sıra ve sayı birlikte girilmeli' })
    if (v.installmentNo && v.installmentCount && v.installmentNo > v.installmentCount) ctx.addIssue({ code: 'custom', path: ['installmentNo'], message: 'taksit sırası taksit sayısından büyük olamaz' })
  })

export const itemPatch = z.object({ name: name.optional(), amount: kurus.optional(), date: date.nullable().optional(), ...installmentFields }).strict()

export const categoryCreate = z.object({ name: z.string().trim().min(1, 'ad gerekli').max(40, 'ad en fazla 40 karakter olabilir'), direction: z.enum(['income', 'expense', 'both']).optional() }).strict()
export const categoryPatch = z
  .object({ name: z.string().trim().min(1, 'ad gerekli').max(40, 'ad en fazla 40 karakter olabilir').optional(), direction: z.enum(['income', 'expense', 'both']).optional(), sort: z.number().int().min(0).max(100_000).optional() })
  .strict()
