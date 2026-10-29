import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ZodType } from 'zod'
import { isMonth } from '../../shared/month'
import type { AppBindings } from '../env'

export type Ctx = Context<AppBindings>

export function fail(status: 400 | 401 | 403 | 404 | 409 | 422, message: string): never {
  throw new HTTPException(status, { message })
}

export async function parseBody<T>(c: Ctx, schema: ZodType<T>): Promise<T> {
  const raw = await c.req.json().catch((): unknown => fail(400, 'geçersiz JSON'))
  const result = schema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue?.path.join('.') ?? ''
    fail(400, path ? `${path}: ${issue?.message}` : (issue?.message ?? 'geçersiz istek'))
  }
  return result.data
}

export function monthParam(c: Ctx, name = 'month'): string {
  const value = c.req.param(name) ?? ''
  if (!isMonth(value)) fail(400, 'ay YYYY-AA biçiminde olmalı')
  return value
}
