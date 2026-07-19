/*******************************************************************************

    uBlock Origin - WebExt Flavor Detection
    https://github.com/gorhill/uBlock

    Detects the current browser/extension platform and sets the appropriate
    flavor flags for conditional code execution.

*******************************************************************************/

interface WebExtFlavor {
    vAPI: any;
    id: string;
    chromium: boolean;
    firefox: boolean;
    safari: boolean;
    mv2: boolean;
    mv3: boolean;
    offscreen: boolean;
    noop: boolean;
    init(vAPI: any): void;
    _detect(): void;
    isFirefox(): boolean;
    isChromium(): boolean;
    isSafari(): boolean;
    isMV3(): boolean;
    isMV2(): boolean;
    supportsServiceWorker(): boolean;
    supportsDeclarativeNetRequest(): boolean;
    supportsOffscreenDocument(): boolean;
}

const webextFlavor: WebExtFlavor = {
    vAPI: null,
    id: 'unknown',
    chromium: false,
    firefox: false,
    safari: false,
    mv2: false,
    mv3: true,
    offscreen: false,
    noop: false,

    init(vAPI: any) {
        this.vAPI = vAPI || (typeof window !== 'undefined' ? (window as any).vAPI : null);
        this._detect();
    },

    _detect() {
        const ua = navigator.userAgent || '';

        if (/Firefox/.test(ua)) {
            this.firefox = true;
            this.id = 'firefox';
        } else if (/Edg\//.test(ua)) {
            this.chromium = true;
            this.id = 'edge';
        } else if (/Chrome/.test(ua)) {
            this.chromium = true;
            this.id = 'chromium';
        } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
            this.safari = true;
            this.id = 'safari';
        }

        if (typeof browser !== 'undefined' && browser.runtime &&
            typeof (browser.runtime as any).getManifest === 'function') {
            const manifest = (browser.runtime as any).getManifest();
            this.mv2 = manifest.manifest_version === 2;
            this.mv3 = manifest.manifest_version === 3;
        } else if (typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined') {
            const manifest = chrome.runtime.getManifest?.();
            this.mv2 = manifest?.manifest_version === 2;
            this.mv3 = manifest?.manifest_version === 3;
        }

        if (this.vAPI) {
            this.vAPI.webextFlavor = this.id;
            this.vAPI.webextFlavorObj = this;
        }
    },

    isFirefox() { return this.firefox; },
    isChromium() { return this.chromium; },
    isSafari() { return this.safari; },
    isMV3() { return this.mv3; },
    isMV2() { return this.mv2; },

    supportsServiceWorker() {
        return this.chromium || (this.firefox && !this.mv2);
    },

    supportsDeclarativeNetRequest() {
        return this.chromium || this.firefox;
    },

    supportsOffscreenDocument() {
        return this.chromium && this.mv3;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    (module as any).exports = webextFlavor;
} else if (typeof window !== 'undefined') {
    (window as any).webextFlavor = webextFlavor;
}

export { webextFlavor };
