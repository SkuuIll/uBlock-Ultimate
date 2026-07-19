declare var vAPI: any

import { SmartRuntime } from '../core/smart-cosmetic/smart-runtime'

var _checkSmartLease = function checkSmartLease(): boolean {
    return true
}

var authorizeSmart = async function authorizeSmart(action: string): Promise<boolean> {
    try {
        return (self as any).__ubrCapability?.validate("smart", action) ?? false
    } catch { return false }
}

const smartRuntime = new SmartRuntime(authorizeSmart, _checkSmartLease)
let initialized = false

async function getMyTabId(): Promise<number> {
    if ( typeof vAPI !== 'object' || vAPI === null ) { return 0 }
    try {
        const result = await vAPI.messaging.send('dashboard', { what: 'getSmartTabId' })
        return result?.tabId ?? 0
    } catch (e) {
    console.warn('[uBR] smart-content: getMyTabId failed', e)
    return 0
    }
}

async function bootstrap(): Promise<void> {
    if (initialized) return
    if ( typeof vAPI !== 'object' || vAPI === null ) { return }
    const policy: any = (typeof self !== 'undefined') ? (self as any).__uborPagePolicy : null
    const cs = policy && typeof policy.contentScript === 'object' ? policy.contentScript : {}
    const smartCosmeticAllowed = cs.loadSmartRuntime === true
    if (!smartCosmeticAllowed) {
        console.log('[uBR] smart-content: disabled by policy (loadSmartRuntime=false)')
        return
    }
    initialized = true

    const url = location.href
    const hostname = location.hostname
    const tabId = await getMyTabId()

    await smartRuntime.init({ tabId, url, hostname })
    ;(self as any).__ubrSmartRuntimeActive = true

    const planDecision: { status: string; reason: string; ruleCount?: number; wildcard?: boolean } = { status: 'skipped', reason: 'no-plan' }

    try {
        const result = await vAPI.messaging.send('dashboard', {
        what: 'getCosmeticPlanForDocument',
        url,
        })
        if ( result && result.plan ) {
            const plan = (result.plan as any)
            const planHost = plan.hostname || ''
            const isWildcard = planHost === '*' || planHost === ''
            const ruleCount = (plan.rules || []).length

            // Reject wildcard plans on unknown/ambiguous hosts (P2.17.146)
            if (isWildcard && hostname !== '' && !hostname.includes('google') && !hostname.includes('youtube')) {
                planDecision.status = 'rejected'
                planDecision.reason = 'wildcard-host'
                planDecision.wildcard = true
                console.warn('[uBR] smart-content: rejecting wildcard plan for non-google host', hostname)
                return
            }

            await smartRuntime.loadPlan(result.plan)
            planDecision.status = 'accepted'
            planDecision.reason = 'loaded'
            planDecision.ruleCount = ruleCount
        } else {
            planDecision.status = 'skipped'
            planDecision.reason = 'no-plan-object'
        }
    } catch (e) {
        planDecision.status = 'error'
        planDecision.reason = String(e)
        console.warn('[uBR] smart-content: bootstrap plan fetch failed', e)
    }

    // Report decision for diagnostics
    try {
        await vAPI.messaging.send('dashboard', {
            what: 'reportSmartCosmeticDecision',
            url,
            hostname,
            decision: planDecision,
        }).catch(() => {})
    } catch (_) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap)
} else {
  bootstrap()
}

// Revocation: when the SW disables the smart runtime it broadcasts
// { what: "ubor:deactivate" }.  Tear down observers, timers, listeners and
// restore wrapped page APIs so already-applied smart effects do not persist
// after policy revocation.
try {
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.onMessage?.addListener === 'function') {
    chrome.runtime.onMessage.addListener((msg: any, _sender: any, _sendResponse: any) => {
      if (msg && msg.what === 'ubor:deactivate') {
        console.warn('[uBR] smart-content: received ubor:deactivate — destroying smart runtime');
        try { smartRuntime.destroy(); } catch (e) {
          console.warn('[uBR] smart-content: destroy failed', e);
        }
        (self as any).__ubrSmartRuntimeActive = false;
        initialized = false;
      }
    });
  }
} catch (_) {}
