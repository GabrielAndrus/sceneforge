import { randomUUID } from 'node:crypto'
import { validate as isUuid, v4 as uuidv4 } from 'uuid'

export type UserRecord = {
  id: string
  name: string
  email: string
  role: 'admin' | 'analyst' | 'viewer'
  status: string
  created_at: string
}

export type PrimaryEntityRecord = Record<string, unknown> & {
  id: string
  created_at?: string
  status?: string
}

export type ActivityLogRecord = {
  id: string
  user_id: string
  primary_entity_id: string
  action: string
  timestamp: string
  details: string
}

export type DashboardMetrics = {
  total_value: number
  active_users: number
  failed_entities: number
  anomaly_score: number
}

export type SandboxData = {
  users: UserRecord[]
  primary_entities: PrimaryEntityRecord[]
  activity_logs: ActivityLogRecord[]
  feature_flags: Record<string, boolean>
  dashboard_metrics: DashboardMetrics
  schema_info: {
    primary_entity_name: string
    domain: string
  }
}

type ArrayLimits = {
  minimum: number
  maximum: number
}

type ParseSandboxOptions = {
  userLimits?: ArrayLimits
  primaryEntityLimits?: ArrayLimits
  activityLogLimits?: ArrayLimits
  description?: string
}

type RawRecord = Record<string, unknown>

const DEFAULT_FEATURE_FLAGS = [
  'smart_retry',
  'fraud_detection',
  'audit_trail',
  'role_enforcement',
  'sandbox_exports',
  'anomaly_alerting',
]

const DEFAULT_ROLES: UserRecord['role'][] = ['admin', 'analyst', 'viewer']
const DEFAULT_USER_STATUS = ['active', 'monitoring', 'restricted']
const DEFAULT_PRIMARY_ENTITY_STATUSES = ['healthy', 'pending', 'failed']
const DEFAULT_LOG_ACTIONS = [
  'entity_created',
  'entity_reviewed',
  'access_reviewed',
  'alert_triggered',
  'feature_flag_checked',
]

function asRecord(value: unknown): RawRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawRecord)
    : {}
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function ensureUuid(value: unknown): string {
  return typeof value === 'string' && isUuid(value) ? value : uuidv4()
}

function parseDate(value: unknown, fallback: Date): Date {
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return fallback
}

function isoMinutesFrom(base: Date, minutesOffset: number): string {
  return new Date(base.getTime() + minutesOffset * 60_000).toISOString()
}

function pick<T>(items: T[], index: number): T {
  return items[index % items.length]
}

function clampArray<T>(items: T[], minimum: number, maximum: number, fill: (index: number) => T): T[] {
  const next = [...items]

  while (next.length < minimum) {
    next.push(fill(next.length))
  }

  return next.slice(0, maximum)
}

function inferPrimaryEntityName(description: string): string {
  const lowered = description.toLowerCase()

  if (lowered.includes('ride') || lowered.includes('driver') || lowered.includes('rider')) {
    return 'trips'
  }

  if (lowered.includes('hospital') || lowered.includes('doctor') || lowered.includes('patient')) {
    return 'appointments'
  }

  if (lowered.includes('e-commerce') || lowered.includes('store') || lowered.includes('shopper') || lowered.includes('order')) {
    return 'orders'
  }

  if (lowered.includes('saas') || lowered.includes('analytics') || lowered.includes('usage')) {
    return 'usage_sessions'
  }

  return 'records'
}

function inferDomain(description: string): string {
  const lowered = description.toLowerCase()

  if (lowered.includes('ride') || lowered.includes('driver') || lowered.includes('rider')) {
    return 'ride sharing'
  }

  if (lowered.includes('hospital') || lowered.includes('doctor') || lowered.includes('patient')) {
    return 'hospital'
  }

  if (lowered.includes('e-commerce') || lowered.includes('store') || lowered.includes('shopper') || lowered.includes('order')) {
    return 'e-commerce'
  }

  if (lowered.includes('saas') || lowered.includes('analytics') || lowered.includes('usage')) {
    return 'saas analytics'
  }

  return 'custom domain'
}

function getRecordTimestamp(record: PrimaryEntityRecord, fallback: Date): string {
  const timestampKeys = ['created_at', 'occurred_at', 'event_at', 'started_at', 'ended_at', 'updated_at']

  for (const key of timestampKeys) {
    if (typeof record[key] === 'string') {
      return parseDate(record[key], fallback).toISOString()
    }
  }

  return fallback.toISOString()
}

function getEntityLabel(record: PrimaryEntityRecord, fallback: string): string {
  const labelKeys = ['name', 'title', 'type', 'category', 'report_name', 'appointment_type', 'status']

  for (const key of labelKeys) {
    if (typeof record[key] === 'string' && record[key].trim()) {
      return record[key].trim()
    }
  }

  return fallback
}

function getRelatedUserIds(record: PrimaryEntityRecord, validUserIds: Set<string>): string[] {
  return Object.entries(record)
    .filter(([key, value]) => key !== 'id' && key.endsWith('_id') && typeof value === 'string' && validUserIds.has(value))
    .map(([, value]) => value as string)
}

function hasFailureStatus(value: unknown): boolean {
  return typeof value === 'string' && /(fail|error|blocked|denied|revoked|incident|anomal|suspend|degrad)/i.test(value)
}

function getNumericSignal(record: PrimaryEntityRecord): number {
  const preferredKeys = [
    'value',
    'revenue',
    'cost',
    'spend',
    'order_value',
    'visit_value',
    'trip_value',
    'usage_credits',
    'query_count',
    'seat_count',
  ]

  for (const key of preferredKeys) {
    if (typeof record[key] === 'number' && Number.isFinite(record[key])) {
      return record[key] as number
    }
  }

  return 0
}

function buildFallbackUser(index: number, createdAt: string): UserRecord {
  const label = index + 1

  return {
    id: uuidv4(),
    name: `Generated User ${label}`,
    email: `generated.user.${label}@sceneforge.dev`,
    role: pick(DEFAULT_ROLES, index),
    status: pick(DEFAULT_USER_STATUS, index),
    created_at: createdAt,
  }
}

function normalizeUsers(rawUsers: unknown[], baseTime: Date, limits: ArrayLimits): UserRecord[] {
  const mapped = rawUsers.map((value, index) => {
    const record = asRecord(value)
    const createdAt = parseDate(record.created_at, new Date(baseTime.getTime() + index * 3_600_000)).toISOString()
    const roleValue = asString(record.role, pick(DEFAULT_ROLES, index)) as UserRecord['role']
    const role = DEFAULT_ROLES.includes(roleValue) ? roleValue : pick(DEFAULT_ROLES, index)

    return {
      id: ensureUuid(record.id),
      name: asString(record.name, `Generated User ${index + 1}`),
      email: asString(record.email, `generated.user.${index + 1}@sceneforge.dev`).toLowerCase(),
      role,
      status: asString(record.status, pick(DEFAULT_USER_STATUS, index)),
      created_at: createdAt,
    }
  })

  return clampArray(mapped, limits.minimum, limits.maximum, (index) =>
    buildFallbackUser(index, isoMinutesFrom(baseTime, index * 15)),
  )
}

function buildFallbackPrimaryEntity(
  index: number,
  users: UserRecord[],
  baseTime: Date,
  description: string,
): PrimaryEntityRecord {
  const lowered = description.toLowerCase()
  const primaryUser = users[index % users.length]
  const secondaryUser = users[(index + 1) % users.length]
  const createdAt = isoMinutesFrom(baseTime, index * 9)
  const status = index % 5 === 0 ? 'failed' : pick(DEFAULT_PRIMARY_ENTITY_STATUSES, index)

  if (lowered.includes('ride') || lowered.includes('driver') || lowered.includes('rider')) {
    return {
      id: uuidv4(),
      driver_id: primaryUser.id,
      rider_id: secondaryUser.id,
      origin: pick(['Downtown', 'Airport', 'Union Station'], index),
      destination: pick(['Marina', 'Financial District', 'Midtown'], index),
      distance_km: Number((4.5 + index * 1.3).toFixed(1)),
      trip_value: Number((18 + index * 4.25).toFixed(2)),
      status,
      surge_multiplier: Number((1 + (index % 3) * 0.25).toFixed(2)),
      rating: Number((4.2 + (index % 4) * 0.1).toFixed(1)),
      created_at: createdAt,
    }
  }

  if (lowered.includes('hospital') || lowered.includes('doctor') || lowered.includes('patient')) {
    return {
      id: uuidv4(),
      patient_id: secondaryUser.id,
      doctor_id: primaryUser.id,
      appointment_type: pick(['follow_up', 'diagnostic', 'telehealth'], index),
      diagnosis: pick(['hypertension_review', 'lab_follow_up', 'annual_exam'], index),
      duration_mins: 20 + index * 5,
      visit_value: Number((120 + index * 35).toFixed(2)),
      insurance_verified: index % 2 === 0,
      status,
      created_at: createdAt,
    }
  }

  if (lowered.includes('saas') || lowered.includes('analytics') || lowered.includes('usage')) {
    return {
      id: uuidv4(),
      analyst_id: primaryUser.id,
      workspace_id: `workspace_${(index % 3) + 1}`,
      report_name: pick(['funnel_analysis', 'retention_breakdown', 'ai_summary'], index),
      query_count: 12 + index * 4,
      ai_feature_used: index % 2 === 0,
      session_duration_mins: 18 + index * 6,
      status: index % 5 === 0 ? 'degraded' : pick(['healthy', 'active', 'completed'], index),
      created_at: createdAt,
    }
  }

  if (lowered.includes('e-commerce') || lowered.includes('store') || lowered.includes('shopper') || lowered.includes('order')) {
    return {
      id: uuidv4(),
      customer_id: primaryUser.id,
      items: [
        { sku: `sku-${index + 1}`, quantity: (index % 3) + 1 },
      ],
      order_value: Number((49 + index * 17.5).toFixed(2)),
      discount_code: index % 2 === 0 ? 'SPRING24' : null,
      shipping_status: pick(['processing', 'fulfilled', 'delayed'], index),
      status,
      created_at: createdAt,
    }
  }

  return {
    id: uuidv4(),
    user_id: primaryUser.id,
    category: pick(['monitoring', 'access', 'usage'], index),
    value: Number((40 + index * 11.5).toFixed(2)),
    status,
    created_at: createdAt,
  }
}

function normalizePrimaryEntities(
  rawPrimaryEntities: unknown[],
  users: UserRecord[],
  baseTime: Date,
  limits: ArrayLimits,
  description: string,
): PrimaryEntityRecord[] {
  const userIds = new Set(users.map((user) => user.id))
  const mapped = rawPrimaryEntities.map((value, index) => {
    const record = asRecord(value)
    const fallback = buildFallbackPrimaryEntity(index, users, baseTime, description)
    const nextRecord: Record<string, unknown> = {
      ...record,
      id: ensureUuid(record.id),
    }

    if (!Object.keys(nextRecord).some((key) => key.endsWith('_at'))) {
      nextRecord.created_at = fallback.created_at
    }

    if (typeof nextRecord.status !== 'string' && typeof fallback.status === 'string') {
      nextRecord.status = fallback.status
    }

    if (getRelatedUserIds(nextRecord as PrimaryEntityRecord, userIds).length === 0) {
      Object.entries(fallback).forEach(([key, value]) => {
        if (key.endsWith('_id') && typeof value === 'string' && userIds.has(value)) {
          nextRecord[key] = value
        }
      })
    }

    return nextRecord as PrimaryEntityRecord
  })

  return clampArray(mapped, limits.minimum, limits.maximum, (index) =>
    buildFallbackPrimaryEntity(index, users, baseTime, description),
  )
}

function buildFallbackLog(
  index: number,
  users: UserRecord[],
  primaryEntities: PrimaryEntityRecord[],
  baseTime: Date,
  description: string,
): ActivityLogRecord {
  const validUserIds = new Set(users.map((user) => user.id))
  const primaryEntity = primaryEntities[index % primaryEntities.length]
  const relatedUserIds = getRelatedUserIds(primaryEntity, validUserIds)
  const userId = relatedUserIds[0] ?? users[index % users.length].id
  const primaryEntityName = inferPrimaryEntityName(description).replace(/_/g, ' ')
  const entityLabel = getEntityLabel(primaryEntity, primaryEntityName)

  return {
    id: uuidv4(),
    user_id: userId,
    primary_entity_id: primaryEntity.id,
    action: pick(DEFAULT_LOG_ACTIONS, index),
    timestamp: isoMinutesFrom(baseTime, index * 6),
    details: `${entityLabel} was included in ${pick(DEFAULT_LOG_ACTIONS, index)} by user ${userId}.`,
  }
}

function normalizeLogs(
  rawLogs: unknown[],
  users: UserRecord[],
  primaryEntities: PrimaryEntityRecord[],
  baseTime: Date,
  limits: ArrayLimits,
  description: string,
): ActivityLogRecord[] {
  const userIds = new Set(users.map((user) => user.id))
  const primaryEntityIds = new Set(primaryEntities.map((entity) => entity.id))

  const mapped = rawLogs.map((value, index) => {
    const record = asRecord(value)
    const fallback = buildFallbackLog(index, users, primaryEntities, baseTime, description)
    const userId = typeof record.user_id === 'string' && userIds.has(record.user_id) ? record.user_id : fallback.user_id
    const primaryEntityId =
      typeof record.primary_entity_id === 'string' && primaryEntityIds.has(record.primary_entity_id)
        ? record.primary_entity_id
        : fallback.primary_entity_id

    return {
      id: ensureUuid(record.id),
      user_id: userId,
      primary_entity_id: primaryEntityId,
      action: asString(record.action, fallback.action),
      timestamp: parseDate(record.timestamp, new Date(fallback.timestamp)).toISOString(),
      details: asString(record.details, fallback.details),
    }
  })

  return clampArray(mapped, limits.minimum, limits.maximum, (index) =>
    buildFallbackLog(index, users, primaryEntities, baseTime, description),
  )
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    .map((log, index, logs) => {
      const relatedEntity = primaryEntities.find((item) => item.id === log.primary_entity_id)
      const minimumTime = relatedEntity
        ? new Date(getRecordTimestamp(relatedEntity, baseTime)).getTime()
        : baseTime.getTime()
      const previousTime = index > 0 ? new Date(logs[index - 1].timestamp).getTime() + 60_000 : minimumTime
      const timestamp = new Date(Math.max(new Date(log.timestamp).getTime(), minimumTime, previousTime)).toISOString()

      return {
        ...log,
        timestamp,
      }
    })
}

function normalizeFeatureFlags(rawFlags: unknown): Record<string, boolean> {
  const flags = asRecord(rawFlags)
  const entries = Object.entries(flags)
    .filter(([key]) => key.trim())
    .slice(0, 6)
    .map(([key, value], index) => [key, asBoolean(value, index % 2 === 0)] as const)

  if (entries.length >= 4) {
    return Object.fromEntries(entries)
  }

  DEFAULT_FEATURE_FLAGS.forEach((flagName, index) => {
    if (entries.length < 6 && !entries.some(([key]) => key === flagName)) {
      entries.push([flagName, index % 2 === 0])
    }
  })

  return Object.fromEntries(entries.slice(0, 6))
}

function deriveDashboardMetrics(
  users: UserRecord[],
  primaryEntities: PrimaryEntityRecord[],
  activityLogs: ActivityLogRecord[],
): DashboardMetrics {
  const totalValue = primaryEntities.reduce((sum, entity) => {
    if (hasFailureStatus(entity.status)) {
      return sum
    }

    return sum + getNumericSignal(entity)
  }, 0)

  const activeUsers = users.filter((user) => /active/i.test(user.status)).length
  const failedEntities = primaryEntities.filter((entity) => hasFailureStatus(entity.status)).length
  const suspiciousLogs = activityLogs.filter((log) =>
    /fail|conflict|anomaly|alert|suspicious|degrad|incident/i.test(`${log.action} ${log.details}`),
  ).length

  return {
    total_value: Number(totalValue.toFixed(2)),
    active_users: activeUsers,
    failed_entities: failedEntities,
    anomaly_score: Number((((failedEntities * 10) + suspiciousLogs * 3) / Math.max(activityLogs.length, 1)).toFixed(2)),
  }
}

export function parseSandboxPayload(rawText: string, options?: ParseSandboxOptions): SandboxData {
  const parsed = JSON.parse(rawText.trim()) as Record<string, unknown>
  const description = asString(parsed.description, options?.description ?? '')
  const baseTime = new Date()
  const userLimits = options?.userLimits ?? { minimum: 3, maximum: 5 }
  const primaryEntityLimits = options?.primaryEntityLimits ?? { minimum: 10, maximum: 15 }
  const activityLogLimits = options?.activityLogLimits ?? { minimum: 15, maximum: 20 }
  const users = normalizeUsers(
    Array.isArray(parsed.users) ? parsed.users : [],
    new Date(baseTime.getTime() - 8 * 3_600_000),
    userLimits,
  )
  const primaryEntities = normalizePrimaryEntities(
    Array.isArray(parsed.primary_entities) ? parsed.primary_entities : [],
    users,
    new Date(baseTime.getTime() - 6 * 3_600_000),
    primaryEntityLimits,
    description,
  )
  const activityLogs = normalizeLogs(
    Array.isArray(parsed.activity_logs) ? parsed.activity_logs : [],
    users,
    primaryEntities,
    new Date(baseTime.getTime() - 5 * 3_600_000),
    activityLogLimits,
    description,
  )
  const featureFlags = normalizeFeatureFlags(parsed.feature_flags)
  const schemaInfoRecord = asRecord(parsed.schema_info)
  const primaryEntityName = asString(
    schemaInfoRecord.primary_entity_name,
    inferPrimaryEntityName(description),
  )
  const domain = asString(schemaInfoRecord.domain, inferDomain(description))

  return {
    users,
    primary_entities: primaryEntities,
    activity_logs: activityLogs,
    feature_flags: featureFlags,
    dashboard_metrics: deriveDashboardMetrics(users, primaryEntities, activityLogs),
    schema_info: {
      primary_entity_name: primaryEntityName,
      domain,
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
