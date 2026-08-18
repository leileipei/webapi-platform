import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { ApiItem, ApiGroup, AppCredential, AlertRule, AlertRecord } from '@/types'
import { seedApis, seedGroups, seedApps, seedAlertRules, seedAlertRecords } from './seed'

const STORAGE_KEY = 'webapi-platform-data-v1'

export interface State {
  apis: ApiItem[]
  groups: ApiGroup[]
  apps: AppCredential[]
  alertRules: AlertRule[]
  alertRecords: AlertRecord[]
}

type Action =
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
      return { ...state, alertRecords: state.alertRecords.map((r) => (r.id === action.id ? { ...r, acked: true } : r)) }
    case 'reset':
      return initState()
    default:
      return state
  }
}

function initState(): State {
  const apis = seedApis()
  return {
    apis,
    groups: seedGroups(),
    apps: seedApps(apis),
    alertRules: seedAlertRules(),
    alertRecords: seedAlertRecords(apis),
  }
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as State
      if (Array.isArray(parsed.apis) && Array.isArray(parsed.groups)) return parsed
    }
  } catch {
    // ignore corrupted storage
  }
  return initState()
}

const StoreContext = createContext<{ state: State; dispatch: React.Dispatch<Action> } | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // storage full — ignore
    }
  }, [state])
  const value = useMemo(() => ({ state, dispatch }), [state])
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
