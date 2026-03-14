import { randomUUID } from 'node:crypto'
import { validate as isUuid, v4 as uuidv4 } from 'uuid'

export type UserRecord = Record<string, unknown> & {
  id: string
}

export type PrimaryEntityRecord = Record<string, unknown> & {
  id: string
}

export type ActivityLogRecord = Record<string, unknown> & {
  id: string
  user_id: string
  primary_entity_id: string
}

export type DashboardMetrics = Record<string, unknown>

export type SandboxData = {
  users: UserRecord[]
  primary_entities: PrimaryEntityRecord[]
  activity_logs: ActivityLogRecord[]
  feature_flags: Record<string, unknown>
  dashboard_metrics: DashboardMetrics
  schema_info: {
    primary_entity_name: string
    domain: string
  }
}

type RawRecord = Record<string, unknown>

function asRecord(value: unknown): RawRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawRecord)
    : {}
}

function ensureUuid(value: unknown): string {
  return typeof value === 'string' && isUuid(value) ? value : uuidv4()
}

function normalizeUsers(rawUsers: unknown): UserRecord[] {
  if (!Array.isArray(rawUsers)) {
    return []
  }

  return rawUsers
    .map((value) => asRecord(value))
    .filter((record) => Object.keys(record).length > 0)
    .map((record) => ({
      ...record,
      id: ensureUuid(record.id),
    }))
}

function isLikelyUserIdField(key: string): boolean {
  if (key === 'id' || key === 'primary_entity_id' || key === 'user_id') {
    return key === 'user_id'
  }

  return /(^user_id$|_user_id$|driver_id$|rider_id$|patient_id$|doctor_id$|customer_id$|owner_id$|admin_id$|analyst_id$|viewer_id$|member_id$|agent_id$|operator_id$|creator_id$|assignee_id$)/i.test(
    key,
  )
}

function repairPrimaryEntityUserRefs(
  primaryEntities: PrimaryEntityRecord[],
  users: UserRecord[],
): PrimaryEntityRecord[] {
  const userIds = new Set(users.map((user) => user.id))
  const fallbackUserIds = users.map((user) => user.id)

  if (fallbackUserIds.length === 0) {
    return primaryEntities
  }

  return primaryEntities.map((entity, index) => {
    const repaired = { ...entity }

    Object.entries(repaired).forEach(([key, value]) => {
      if (!isLikelyUserIdField(key)) {
        return
      }

      if (typeof value !== 'string' || !userIds.has(value)) {
        repaired[key] = fallbackUserIds[index % fallbackUserIds.length]
      }
    })

    return repaired
  })
}

function normalizePrimaryEntities(rawPrimaryEntities: unknown, users: UserRecord[]): PrimaryEntityRecord[] {
  if (!Array.isArray(rawPrimaryEntities)) {
    return []
  }

  const primaryEntities = rawPrimaryEntities
    .map((value) => asRecord(value))
    .filter((record) => Object.keys(record).length > 0)
    .map((record) => ({
      ...record,
      id: ensureUuid(record.id),
    }))

  return repairPrimaryEntityUserRefs(primaryEntities, users)
}

function normalizeActivityLogs(
  rawLogs: unknown,
  users: UserRecord[],
  primaryEntities: PrimaryEntityRecord[],
): ActivityLogRecord[] {
  if (!Array.isArray(rawLogs)) {
    return []
  }

  const userIds = users.map((user) => user.id)
  const validUserIds = new Set(userIds)
  const primaryEntityIds = primaryEntities.map((entity) => entity.id)
  const validPrimaryEntityIds = new Set(primaryEntityIds)

  return rawLogs
    .map((value) => asRecord(value))
    .filter((record) => Object.keys(record).length > 0)
    .map((record, index) => ({
      ...record,
      id: ensureUuid(record.id),
      user_id:
        typeof record.user_id === 'string' && validUserIds.has(record.user_id)
          ? record.user_id
          : userIds[index % userIds.length] ?? ensureUuid(undefined),
      primary_entity_id:
        typeof record.primary_entity_id === 'string' && validPrimaryEntityIds.has(record.primary_entity_id)
          ? record.primary_entity_id
          : primaryEntityIds[index % primaryEntityIds.length] ?? ensureUuid(undefined),
    }))
}

export function parseSandboxPayload(rawText: string): SandboxData {
  const parsed = JSON.parse(rawText.trim()) as Record<string, unknown>
  const users = normalizeUsers(parsed.users)
  const primaryEntities = normalizePrimaryEntities(parsed.primary_entities, users)
  const activityLogs = normalizeActivityLogs(parsed.activity_logs, users, primaryEntities)

  return {
    users,
    primary_entities: primaryEntities,
    activity_logs: activityLogs,
    feature_flags: asRecord(parsed.feature_flags),
    dashboard_metrics: asRecord(parsed.dashboard_metrics),
    schema_info: {
      primary_entity_name:
        typeof asRecord(parsed.schema_info).primary_entity_name === 'string'
          ? (asRecord(parsed.schema_info).primary_entity_name as string)
          : '',
      domain:
        typeof asRecord(parsed.schema_info).domain === 'string'
          ? (asRecord(parsed.schema_info).domain as string)
          : '',
    },
  }
}

export function createSandboxRecord(description: string, data: SandboxData) {
  const now = new Date()

  return {
    id: randomUUID(),
    description,
    data,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
  }
}

export function createTemplateRecord(name: string, description: string, data: SandboxData) {
  return {
    id: randomUUID(),
    name,
    description,
    data,
    created_at: new Date().toISOString(),
  }
}
