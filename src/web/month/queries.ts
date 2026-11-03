import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuditRecentItem, CategoryDto, DebtPoint, EntryDto, SearchDto, EntryItemDto, RecentEntryDto, MonthDto, PlanDetailDto, PlanDto, SettingsDto, UpcomingDto, YearDto } from '../../shared/api'
import { api } from '../api'

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsDto>('/settings'), staleTime: 5 * 60_000 })

export const useMonth = (month: string) => useQuery({ queryKey: ['month', month], queryFn: () => api<MonthDto>(`/months/${month}`), placeholderData: (previous) => previous })

export type EntryEdit = {
  categoryId?: string | null
  name?: string
  plannedAmount?: number
  actualAmount?: number | null
  dueDate?: string | null
  isEstimate?: boolean
  autoPay?: boolean
  note?: string | null
  scope?: 'this' | 'following' | 'all'
}

export type EntryCreate = {
  categoryId?: string | null
  month: string
  direction: 'income' | 'expense'
  name: string
  plannedAmount: number
  dueDate?: string
  autoPay?: boolean
  isEstimate?: boolean
  note?: string
}

/** Kayıt değişikliklerinden sonra ay, yıl ve yaklaşan verilerini tazeler. */
export function useEntryActions() {
  const client = useQueryClient()
  const refresh = () => Promise.all(['month', 'upcoming', 'year', 'recent-entries', 'plans', 'plan'].map((key) => client.invalidateQueries({ queryKey: [key] })))
  const optimisticPaid = (id: string, paid: boolean) =>
    client.setQueriesData<MonthDto>({ queryKey: ['month'] }, (data) => data && { ...data, entries: data.entries.map((e) => (e.id === id ? { ...e, paid } : e)) })

  return {
    create: useMutation({ mutationFn: (body: EntryCreate) => api<EntryDto>('/entries', { body }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...body }: EntryEdit & { id: string }) => api<EntryDto>(`/entries/${id}`, { method: 'PATCH', body }), onSuccess: refresh }),
    togglePaid: useMutation({
      mutationFn: ({ id, paid }: { id: string; paid: boolean }) => api<EntryDto>(`/entries/${id}/${paid ? 'pay' : 'unpay'}`, { body: {} }),
      onMutate: ({ id, paid }) => optimisticPaid(id, paid),
      onSettled: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/entries/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
    removeClosed: useMutation({ mutationFn: (id: string) => api(`/entries/${id}?closed=1`, { method: 'DELETE' }), onSuccess: refresh }),
    restore: useMutation({ mutationFn: (id: string) => api(`/entries/${id}/restore`, { body: {} }), onSuccess: refresh }),
  }
}

export const useUpcoming = (days = 30) => useQuery({ queryKey: ['upcoming', days], queryFn: () => api<UpcomingDto>(`/upcoming?days=${days}`) })

export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: () => api<PlanDto[]>('/plans') })

export const usePlan = (id: string) => useQuery({ queryKey: ['plan', id], enabled: id !== '', queryFn: () => api<PlanDetailDto>(`/plans/${id}`) })

export type PlanCreate = {
  categoryId?: string | null
  direction: 'income' | 'expense'
  kind: 'recurring' | 'installment'
  name: string
  amount: number
  dayOfMonth: number
  startMonth: string
  installmentCount?: number
  variable?: boolean
  card?: boolean
  autoPay?: boolean
  markPastPaid?: boolean
}

export function usePlanActions() {
  const client = useQueryClient()
  const refresh = () => Promise.all(['plans', 'plan', 'month', 'upcoming', 'year'].map((key) => client.invalidateQueries({ queryKey: [key] })))
  return {
    create: useMutation({ mutationFn: (body: PlanCreate) => api<{ plan: PlanDto; createdEntries: number }>('/plans', { body }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/plans/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
    close: useMutation({ mutationFn: ({ id, ...body }: { id: string; fromMonth: string; payoffAmount?: number }) => api(`/plans/${id}/close`, { body }), onSuccess: refresh }),
    backfill: useMutation({ mutationFn: (id: string) => api<{ ok: true; created: number }>(`/plans/${id}/backfill`, { body: {} }), onSuccess: refresh }),
    estimate: useMutation({ mutationFn: ({ id, amount }: { id: string; amount: number }) => api<{ ok: true; updatedEntries: number }>(`/plans/${id}/estimate`, { body: { amount } }), onSuccess: refresh }),
    schedule: useMutation({
      mutationFn: ({ id, ...body }: { id: string; text: string; startNo?: number; force?: boolean; dryRun?: boolean }) =>
        api<{ dryRun: boolean; count: number; expected: number; mismatch: boolean; willUpdate: number; skipped: number }>(`/plans/${id}/schedule`, { body }),
      onSuccess: (_data, vars) => (vars.dryRun ? undefined : refresh()),
    }),
  }
}

export const useMembers = () => useQuery({ queryKey: ['members'], queryFn: () => api<{ id: string; name: string }[]>('/auth/members'), staleTime: 5 * 60_000 })

export function useMonthActions(month: string) {
  const client = useQueryClient()
  const refresh = () => Promise.all(['month', 'year', 'upcoming'].map((key) => client.invalidateQueries({ queryKey: [key] })))
  return {
    close: useMutation({ mutationFn: (body: { bankBalance: number; name?: string }) => api<MonthDto>(`/months/${month}/close`, { body }), onSuccess: refresh }),
    sync: useMutation({ mutationFn: (body: { bankBalance: number }) => api<MonthDto>(`/months/${month}/sync`, { body }), onSuccess: refresh }),
    reopen: useMutation({ mutationFn: () => api<MonthDto>(`/months/${month}/reopen`, { body: {} }), onSuccess: refresh }),
  }
}

export function useSetupActions() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ periodStartDay, current, month, balance }: { periodStartDay: number; current: number; month: string | ((day: number) => string); balance: number }) => {
      if (periodStartDay !== current) await api('/settings', { method: 'PUT', body: { periodStartDay } })
      return api<MonthDto>(`/months/${typeof month === 'string' ? month : month(periodStartDay)}/opening`, { method: 'PUT', body: { balance } })
    },
    onSuccess: () => client.invalidateQueries(),
  })
}

export const useYear = (year: number) => useQuery({ queryKey: ['year', year], queryFn: () => api<YearDto>(`/years/${year}`), placeholderData: (previous) => previous })

export type AuditItem = { id: string; action: string; at: number; by: string | null; before: unknown; after: unknown }

export const useAudit = (entity: 'plan' | 'entry' | 'month', id: string, enabled: boolean) =>
  useQuery({ queryKey: ['audit', entity, id], enabled, queryFn: () => api<AuditItem[]>(`/audit?entity=${entity}&id=${encodeURIComponent(id)}`) })

export const useRecentAudit = () =>
  useInfiniteQuery({
    queryKey: ['audit-recent'],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => api<{ items: AuditRecentItem[]; next: number | null }>(`/audit/recent?limit=50${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.next,
  })

export type ItemInput = { name: string; amount: number; date?: string | null; installmentNo?: number | null; installmentCount?: number | null }
type ItemsResponse = { entry: EntryDto; items: EntryItemDto[] }

export function useItems(entryId: string, enabled = true) {
  const client = useQueryClient()
  const key = ['items', entryId]
  const query = useQuery({ queryKey: key, enabled, queryFn: () => api<ItemsResponse>(`/entries/${entryId}/items`) })
  const done = (data: ItemsResponse) => {
    client.setQueryData(key, data)
    return Promise.all(['month', 'upcoming', 'year'].map((k) => client.invalidateQueries({ queryKey: [k] })))
  }
  return {
    query,
    add: useMutation({ mutationFn: (body: ItemInput) => api<ItemsResponse>(`/entries/${entryId}/items`, { body }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }: Partial<ItemInput> & { id: string }) => api<ItemsResponse>(`/entries/${entryId}/items/${id}`, { method: 'PATCH', body }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api<ItemsResponse>(`/entries/${entryId}/items/${id}`, { method: 'DELETE' }), onSuccess: done }),
  }
}

export const useRecentEntries = () => useQuery({ queryKey: ['recent-entries'], queryFn: () => api<RecentEntryDto[]>('/entries/recent'), staleTime: 60_000 })

export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api<CategoryDto[]>('/categories'), staleTime: 5 * 60_000 })

export function useCategoryActions() {
  const client = useQueryClient()
  const refresh = () => Promise.all(['categories', 'month', 'year', 'search'].map((key) => client.invalidateQueries({ queryKey: [key] })))
  return {
    create: useMutation({ mutationFn: (body: { name: string; direction: CategoryDto['direction'] }) => api<CategoryDto>('/categories', { body }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...body }: { id: string; name?: string; direction?: CategoryDto['direction'] }) => api<CategoryDto>(`/categories/${id}`, { method: 'PATCH', body }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api(`/categories/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  }
}

export function useSearch(params: { q: string; category: string; from: string; to: string }) {
  const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
  return useQuery({ queryKey: ['search', search], enabled: !!(params.q.trim() || params.category), queryFn: () => api<SearchDto>(`/search?${search}`), placeholderData: (previous) => previous })
}

export const useDebt = (planId?: string) => useQuery({ queryKey: ['plans', 'debt', planId ?? 'all'], queryFn: () => api<DebtPoint[]>(`/plans/debt${planId ? `?plan=${planId}` : ''}`) })
