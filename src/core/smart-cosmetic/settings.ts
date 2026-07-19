export interface SmartSettings {
  enabled: boolean
  autoUpdate: boolean
  updateIntervalHours: number
  maxSelectorsPerTab: number
  debugMode: boolean
  enableCollections: boolean
}

const STORAGE_KEY = 'smartCosmeticSettings'

export const DEFAULT_SETTINGS: SmartSettings = {
  enabled: true,
  autoUpdate: true,
  updateIntervalHours: 24,
  maxSelectorsPerTab: 50,
  debugMode: false,
  enableCollections: true,
}

let cachedSettings: SmartSettings | null = null

export async function loadSettings(): Promise<SmartSettings> {
    if (cachedSettings) return cachedSettings
    const storage = typeof chrome !== 'undefined' && chrome.storage?.local
        ? chrome.storage.local
        : { get: async () => ({}) }

    const bin = await storage.get(STORAGE_KEY)
    cachedSettings = { ...DEFAULT_SETTINGS, ...(bin[STORAGE_KEY] || {}) }
    return cachedSettings
}

export async function saveSettings(settings: Partial<SmartSettings>): Promise<SmartSettings> {
    const current = await loadSettings()
    cachedSettings = { ...current, ...settings }
    const storage = typeof chrome !== 'undefined' && chrome.storage?.local
        ? chrome.storage.local
        : { set: async () => {} }

    await storage.set({ [STORAGE_KEY]: cachedSettings })
    return cachedSettings
}

export async function resetSettings(): Promise<SmartSettings> {
    cachedSettings = { ...DEFAULT_SETTINGS }
    const storage = typeof chrome !== 'undefined' && chrome.storage?.local
        ? chrome.storage.local
        : { set: async () => {} }

    await storage.set({ [STORAGE_KEY]: DEFAULT_SETTINGS })
    return cachedSettings
}

export function getCached(): SmartSettings | null {
    return cachedSettings
}

export async function isEnabled(): Promise<boolean> {
    const settings = await loadSettings()
    return settings.enabled
}

export * as Settings from './settings'
