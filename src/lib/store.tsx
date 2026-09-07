import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { ApiItem, ApiGroup, AppCredential, AlertRule, AlertRecord } from '@/types'
import { apiClient } from './api'

export interface State {
  apis: ApiItem[]
  groups: ApiGroup[]
  apps: AppCredential[]
  alertRules: AlertRule[]
  alertRecords: AlertRecord[]
}

type Action =
  | { type: 'load'; state: State }
  | { type: 'upsertApi'; api: ApiItem }
  | { type: 'deleteApi'; id: string }
  | { type: 'setApiStatus'; id: string; status: ApiItem['status'] }
  | { type: 'upsertGroup'; group: ApiGroup }
  | { type: 'deleteGroup'; id: string }
  | { type: 'upsertApp'; app: AppCredential }
  | { type: 'deleteApp'; id: string }
  | { type: 'upsertRule'; rule: AlertRule }
  | { type: 'deleteRule'; id: string }
  | { type: 'ackAlert'; id: string }
  | { type: 'reset' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'load':
      return action.state
    case 'upsertApi': {
      const idx = state.apis.findIndex((a) => a.id === action.api.id)
      const apis = idx >= 0 ? state.apis.map((a) => (a.id === action.api.id ? action.api : a)) : [action.api, ...state.apis]
      return { ...state, apis }
    }
    case 'deleteApi':
      return {
        ...state,
        apis: state.apis.filter((a) => a.id !== action.id),
        apps: state.apps.map((app) => ({ ...app, apiIds: app.apiIds.filter((id) => id !== action.id) })),
      }
    case 'setApiStatus':
      return {
        ...state,
        apis: state.apis.map((a) =>
          a.id === action.id
            ? { ...a, status: action.status, updatedAt: new Date().toISOString().slice(0, 10), health: action.status === 'offline' ? 'unknown' : a.health }
            : a,
        ),
      }
    case 'upsertGroup': {
      const idx = state.groups.findIndex((g) => g.id === action.group.id)
      return { ...state, groups: idx >= 0 ? state.groups.map((g) => (g.id === action.group.id ? action.group : g)) : [...state.groups, action.group] }
    }
    case 'deleteGroup':
      return { ...state, groups: state.groups.filter((g) => g.id !== action.id) }
    case 'upsertApp': {
      const idx = state.apps.findIndex((a) => a.id === action.app.id)
      return { ...state, apps: idx >= 0 ? state.apps.map((a) => (a.id === action.app.id ? action.app : a)) : [...state.apps, action.app] }
    }
    case 'deleteApp':
      return { ...state, apps: state.apps.filter((a) => a.id !== action.id) }
    case 'upsertRule': {
      const idx = state.alertRules.findIndex((r) => r.id === action.rule.id)
      return { ...state, alertRules: idx >= 0 ? state.alertRules.map((r) => (r.id === action.rule.id ? action.rule : r)) : [...state.alertRules, action.rule] }
    }
    case 'deleteRule':
      return { ...state, alertRules: state.alertRules.filter((r) => r.id !== action.id) }
    case 'ackAlert':
      return { ...state, alertRecords: state.alertRecords.map((r) => (r.id === action.id ? { ...r, acked: 1 } : r)) }
    default:
      return state
  }
}

const emptyState: State = { apis: [], groups: [], apps: [], alertRules: [], alertRecords: [] }

/** 把动作同步到后端，成功后更新本地状态；失败时 toast 且不更新本地 */
async function syncToBackend(action: Action): Promise<void> {
  switch (action.type) {
    case 'upsertApi':
      await apiClient.post('/admin/apis', action.api)
      break
    case 'deleteApi':
      await apiClient.del(`/admin/apis/${action.id}`)
      break
    case 'setApiStatus':
      await apiClient.post(`/admin/apis/${action.id}/status`, { status: action.status })
      break
    case 'upsertGroup':
      await apiClient.post('/admin/groups', action.group)
      break
    case 'deleteGroup':
      await apiClient.del(`/admin/groups/${action.id}`)
      break
    case 'upsertApp':
      await apiClient.post('/admin/apps', action.app)
      break
    case 'deleteApp':
      await apiClient.del(`/admin/apps/${action.id}`)
      break
    case 'upsertRule':
      await apiClient.post('/admin/rules', action.rule)
      break
    case 'deleteRule':
      await apiClient.del(`/admin/rules/${action.id}`)
      break
    case 'ackAlert':
      await apiClient.post(`/admin/alerts/${action.id}/ack`, {})
      break
    case 'reset':
      await apiClient.post('/admin/reset', {})
      break
    default:
      break
  }
}

interface StoreValue {
  state: State
  dispatch: (action: Action) => void
  ready: boolean
  loadError: string | null
  reload: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, localDispatch] = useReducer(reducer, emptyState)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(() => {
    apiClient
      .getState<State>()
      .then((s) => {
        localDispatch({ type: 'load', state: s })
        setReady(true)
        setLoadError(null)
      })
      .catch((err) => {
        setLoadError(err?.message ?? '无法连接后端')
        setReady(true)
      })
  }, [])

  useEffect(load, [load])

  const dispatch = useCallback(
    (action: Action) => {
      syncToBackend(action)
        .then(() => {
          if (action.type === 'reset') {
            load()
          } else {
            localDispatch(action)
          }
        })
        .catch((err) => {
          toast.error(`操作失败：${err?.message ?? '后端不可用'}`)
        })
    },
    [load],
  )

  const value = useMemo(
    () => ({ state, dispatch, ready, loadError, reload: load }),
    [state, dispatch, ready, loadError, load],
  )
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}
