// YouTube V17 Feature Gate Settings — §8, §32
// Defines all V17 feature gates, their defaults, and a type-safe reader.
// Settings are stored in chrome.storage.local under "userSettings" keys.

export const YOUTUBE_SETTING_KEYS = {
  SMART_BLOCKING: "youtubeSmartBlockingEnabled",
  DETECTION_NEUTRAL_MODE: "youtubeDetectionNeutralMode",
  SHADOW_MODE: "youtubeShadowMode",
  SURROGATES_ENABLED: "youtubeSurrogatesEnabled",
  DATA_SANITIZER: "youtubeDataSanitizerEnabled",
  CONFIG_SANITIZER: "youtubeConfigSanitizerEnabled",
  COSMETIC_CLEANUP: "youtubeCosmeticCleanupEnabled",
  PROMPT_DETECTOR: "youtubePromptDetectorEnabled",
  AUTO_BACKOFF: "youtubeAutoBackoffEnabled",
  BEACON_LOCAL_COMPLETE: "youtubeBeaconLocalComplete",
  INSTRUMENTED_SHADOW: "youtubeInstrumentedShadow",
  AGGRESSIVE_MODE: "youtubeAggressiveMode",
} as const

export const YOUTUBE_SETTING_DEFAULTS = {
  [YOUTUBE_SETTING_KEYS.SMART_BLOCKING]: false,
  [YOUTUBE_SETTING_KEYS.DETECTION_NEUTRAL_MODE]: true,
  [YOUTUBE_SETTING_KEYS.SHADOW_MODE]: true,
  [YOUTUBE_SETTING_KEYS.SURROGATES_ENABLED]: true,
  [YOUTUBE_SETTING_KEYS.DATA_SANITIZER]: true,
  [YOUTUBE_SETTING_KEYS.CONFIG_SANITIZER]: true,
  [YOUTUBE_SETTING_KEYS.COSMETIC_CLEANUP]: true,
  [YOUTUBE_SETTING_KEYS.PROMPT_DETECTOR]: true,
  [YOUTUBE_SETTING_KEYS.AUTO_BACKOFF]: true,
  [YOUTUBE_SETTING_KEYS.BEACON_LOCAL_COMPLETE]: true,
  [YOUTUBE_SETTING_KEYS.INSTRUMENTED_SHADOW]: false,
  [YOUTUBE_SETTING_KEYS.AGGRESSIVE_MODE]: false,
} as const

export type YouTubeSettingKey = keyof typeof YOUTUBE_SETTING_KEYS

export interface YouTubeSettings {
  youtubeSmartBlockingEnabled: boolean
  youtubeDetectionNeutralMode: boolean
  youtubeShadowMode: boolean
  youtubeSurrogatesEnabled: boolean
  youtubeDataSanitizerEnabled: boolean
  youtubeConfigSanitizerEnabled: boolean
  youtubeCosmeticCleanupEnabled: boolean
  youtubePromptDetectorEnabled: boolean
  youtubeAutoBackoffEnabled: boolean
  youtubeBeaconLocalComplete: boolean
  youtubeInstrumentedShadow: boolean
  youtubeAggressiveMode: boolean
}

export function readYouTubeSettings(raw: Record<string, unknown>): YouTubeSettings {
    return {
    youtubeSmartBlockingEnabled: raw.youtubeSmartBlockingEnabled === true,
    youtubeDetectionNeutralMode: raw.youtubeDetectionNeutralMode !== false,
    youtubeShadowMode: raw.youtubeShadowMode !== false,
    youtubeSurrogatesEnabled: raw.youtubeSurrogatesEnabled !== false,
    youtubeDataSanitizerEnabled: raw.youtubeDataSanitizerEnabled !== false,
    youtubeConfigSanitizerEnabled: raw.youtubeConfigSanitizerEnabled !== false,
    youtubeCosmeticCleanupEnabled: raw.youtubeCosmeticCleanupEnabled !== false,
    youtubePromptDetectorEnabled: raw.youtubePromptDetectorEnabled !== false,
    youtubeAutoBackoffEnabled: raw.youtubeAutoBackoffEnabled !== false,
    youtubeBeaconLocalComplete: raw.youtubeBeaconLocalComplete !== false,
    youtubeInstrumentedShadow: raw.youtubeInstrumentedShadow === true,
    youtubeAggressiveMode: raw.youtubeAggressiveMode === true,
    }
}

export async function readYouTubeSettingsFromStorage(): Promise<YouTubeSettings> {
    const stored = await chrome.storage.local.get("userSettings")
    const userSettings = (stored?.userSettings ?? {}) as Record<string, unknown>
    return readYouTubeSettings(userSettings)
}

export function createSettingDefaultsPayload(): Record<string, boolean> {
    return { ...YOUTUBE_SETTING_DEFAULTS }
}
