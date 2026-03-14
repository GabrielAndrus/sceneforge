type UserRecord = {
  id: string
  status: string
}

type PrimaryEntityRecord = Record<string, unknown> & {
  id: string
}

type ActivityLogRecord = {
  id: string
  user_id: string
  primary_entity_id: string
}

type SandboxData = {
  users: UserRecord[]
  primary_entities: PrimaryEntityRecord[]
  activity_logs: ActivityLogRecord[]
  dashboard_metrics: {
    failed_entities: number
    anomaly_score: number
  }
}

type GenerateResponse = {
  sandbox_id: string
  data: SandboxData
}

type ChaosResponse = GenerateResponse & {
  chaos_applied: string
}

const API_URL = 'http://localhost:3001'
const DESCRIPTION =
  'E-commerce platform, 5 users, 1 store owner, 2 customer support reps, 2 shoppers, 3 months of order history, discount codes enabled'

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  const payload = (await response.json().catch(() => ({ error: 'Invalid JSON response.' }))) as
    | T
    | { error?: string }

  if (!response.ok) {
    const message =
      typeof (payload as { error?: string }).error === 'string'
        ? (payload as { error: string }).error
        : `Request failed with status ${response.status}`
    throw new Error(message)
  }

  return payload as T
}

function printCheck(name: string, passed: boolean) {
  console.log(`${passed ? 'PASS' : 'FAIL'} - ${name}`)
}

function getRelatedUserIds(record: PrimaryEntityRecord, validUserIds: Set<string>): string[] {
  return Object.entries(record)
    .filter(([key, value]) => key !== 'id' && key.endsWith('_id') && typeof value === 'string' && validUserIds.has(value))
    .map(([, value]) => value as string)
}

function hasFailureStatus(value: unknown): boolean {
  return typeof value === 'string' && /(fail|error|blocked|denied|revoked|incident|anomal|suspend|degrad)/i.test(value)
}

async function main() {
  let passedChecks = 0
  let totalChecks = 0

  function check(name: string, passed: boolean) {
    totalChecks += 1
    if (passed) {
      passedChecks += 1
    }

    printCheck(name, passed)
  }

  const generated = await apiRequest<GenerateResponse>('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ description: DESCRIPTION }),
  })

  console.log(`sandbox_id: ${generated.sandbox_id}`)

  const userIds = new Set(generated.data.users.map((user) => user.id))
  const primaryEntityIds = new Set(generated.data.primary_entities.map((entity) => entity.id))

  check(
    'Every primary entity references at least one real user id',
    generated.data.primary_entities.every((entity) => getRelatedUserIds(entity, userIds).length > 0),
  )
  check(
    'Every activity_log.user_id exists in users',
    generated.data.activity_logs.every((log) => userIds.has(log.user_id)),
  )
  check(
    'Every activity_log.primary_entity_id exists in primary_entities',
    generated.data.activity_logs.every((log) => primaryEntityIds.has(log.primary_entity_id)),
  )

  const beforeUserStatusById = new Map(generated.data.users.map((user) => [user.id, user.status]))
  const beforeLogIds = new Set(generated.data.activity_logs.map((log) => log.id))
  const beforeAnomalyScore = generated.data.dashboard_metrics.anomaly_score

  const chaos = await apiRequest<ChaosResponse>('/api/chaos', {
    method: 'POST',
    body: JSON.stringify({
      sandbox_id: generated.sandbox_id,
      chaos_type: 'failed_payment',
    }),
  })

  const failedPrimaryEntities = chaos.data.primary_entities.filter((entity) => hasFailureStatus(entity.status))
  const failedPrimaryEntityIds = new Set(failedPrimaryEntities.map((entity) => entity.id))
  const changedUsers = chaos.data.users.filter(
    (user) => beforeUserStatusById.get(user.id) !== undefined && beforeUserStatusById.get(user.id) !== user.status,
  )
  const newLogs = chaos.data.activity_logs.filter((log) => !beforeLogIds.has(log.id))

  check(
    'At least one primary entity has a failure-like status',
    failedPrimaryEntities.length > 0,
  )
  check(
    'At least one user has a changed status',
    changedUsers.length > 0,
  )
  check(
    'At least one new activity_log references a real failed primary_entity_id',
    newLogs.some(
      (log) =>
        failedPrimaryEntityIds.has(log.primary_entity_id) &&
        chaos.data.users.some((user) => user.id === log.user_id),
    ),
  )
  check(
    'dashboard_metrics anomaly_score is higher than before chaos',
    chaos.data.dashboard_metrics.anomaly_score > beforeAnomalyScore,
  )

  console.log(`Summary: ${passedChecks}/${totalChecks} checks passed`)
}

main().catch((error) => {
  console.error(`Test run failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
