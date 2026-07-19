(() => {
  // webext-flavor.ts
  const webextFlavor = {
    vAPI: null,
    id: "unknown",
    chromium: false,
    firefox: false,
    safari: false,
    mv2: false,
    mv3: true,
    offscreen: false,
    noop: false,
    init(vAPI) {
        this.vAPI = vAPI || (typeof window !== "undefined" ? window.vAPI : null);
      this._detect();
    },
    _detect() {
        const ua = navigator.userAgent || "";
        if (/Firefox/.test(ua)) {
            this.firefox = true;
            this.id = "firefox";
        } else if (/Edg\//.test(ua)) {
            this.chromium = true;
            this.id = "edge";
        } else if (/Chrome/.test(ua)) {
            this.chromium = true;
            this.id = "chromium";
        } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
            this.safari = true;
            this.id = "safari";
        }
        if (typeof browser !== "undefined" && browser.runtime && typeof browser.runtime.getManifest === "function") {
            const manifest = browser.runtime.getManifest();
            this.mv2 = manifest.manifest_version === 2;
            this.mv3 = manifest.manifest_version === 3;
        } else if (typeof chrome !== "undefined" && typeof chrome.runtime !== "undefined") {
            const manifest = chrome.runtime.getManifest?.();
            this.mv2 = manifest?.manifest_version === 2;
            this.mv3 = manifest?.manifest_version === 3;
        }
        if (this.vAPI) {
            this.vAPI.webextFlavor = this.id;
            this.vAPI.webextFlavorObj = this;
        }
    },
    isFirefox() {
        return this.firefox;
    },
    isChromium() {
        return this.chromium;
    },
    isSafari() {
        return this.safari;
    },
    isMV3() {
        return this.mv3;
    },
    isMV2() {
        return this.mv2;
    },
    supportsServiceWorker() {
        return this.chromium || this.firefox && !this.mv2;
    },
    supportsDeclarativeNetRequest() {
        return this.chromium || this.firefox;
    },
    supportsOffscreenDocument() {
        return this.chromium && this.mv3;
    }
  };
  if (typeof module !== "undefined" && module.exports) {
      module.exports = webextFlavor;
  } else if (typeof window !== "undefined") {
      window.webextFlavor = webextFlavor;
  }
})();
