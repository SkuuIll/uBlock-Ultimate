/*******************************************************************************

    uBlock Origin - MV3 Picker
    https://github.com/gorhill/uBlock

    This file contains the Element Picker functionality.

*******************************************************************************/

import type { LegacyMessagingAPI } from "./sw-types.js";
import { epickerArgs } from "./sw-messaging.js";
import { popupState, ensurePopupState } from "./sw-storage.js";
import { reloadAllFilterLists } from "./sw-policies.js";

export const createPicker = (
    messaging: LegacyMessagingAPI,
    zapper: {
    isActive: () => boolean;
    getTabId: () => number | null;
  },
) => {
    let active = false;
    let tabId: number | null = null;
    let sessionId: string | null = null;

    async function appendUserFilters(filters: string) {
        const newFilters = filters
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
        if (newFilters.length === 0) {
            return { success: true };
        }

        const stored = await chrome.storage.local.get([
      "userFilters",
      "user-filters",
      "selectedFilterLists",
        ]);
        const existing =
      typeof stored.userFilters === "string"
          ? stored.userFilters
          : typeof stored["user-filters"] === "string"
              ? stored["user-filters"]
              : "";
        const lines = existing
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
        for (const filter of newFilters) {
            if (lines.includes(filter) === false) {
        lines.push(filter);
            }
        }

        const selected = new Set(
      Array.isArray(stored.selectedFilterLists)
          ? stored.selectedFilterLists
          : [],
        );
    selected.add("user-filters");

    const updated = lines.join("\n");
    await chrome.storage.local.set({
      userFilters: updated,
      "user-filters": updated,
      selectedFilterLists: Array.from(selected),
    });
    try {
      new BroadcastChannel("uBR").postMessage({ what: "userFiltersUpdated" });
    } catch (e) {
        console.warn('[uBR] appendUserFilters: BroadcastChannel postMessage failed', e);
    }
    try {
        await reloadAllFilterLists(popupState, ensurePopupState);
    } catch (e) {
        console.warn('[uBR] appendUserFilters: reloadAllFilterLists failed', e);
    }
    return { success: true };
    }

    function safeTabsSendMessage(
        targetTabId: number,
        message: any,
        callback?: (_response: any) => void,
    ) {
        try {
      chrome.tabs.sendMessage(targetTabId, message, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
              callback?.({ error: err.message });
              return;
          }
          callback?.(response);
      });
        } catch (e) {
            callback?.({ error: (e as Error).message });
        }
    }

    function activate(
        targetTabId: number | null,
        callback?: (_response: any) => void,
    ) {
        if (targetTabId === null) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
              activate(tabs[0].id, callback);
          } else if (callback) {
              callback({ error: "No active tab" });
          }
      });
      return;
        }

        active = true;
        tabId = targetTabId;
        sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);
        // Ensure element picker arguments aren't left in zapper mode.
        epickerArgs.zap = false;

    console.log(
        "[MV3 Picker] activate called for tab:",
        tabId,
        "sessionId:",
        sessionId,
    );

    // Prefer direct injection: avoids timing issues if the content script
    // listener isn't ready yet, and matches the MV3 context-menu approach.
    chrome.scripting
      .executeScript({
        target: { tabId },
        files: ["/js/scripting/tool-overlay.js", "/js/scripting/picker.js"],
      })
      .then(() => {
          callback?.({ success: true });
      })
      .catch((e) => {
          console.warn('[uBR] picker activate: executeScript failed, falling back to sendMessage', e);
          // Fallback to message-based launch if injection fails for some reason.
          safeTabsSendMessage(tabId, { topic: "pickerActivate", payload: { sessionId } }, (response) => {
          console.log("[MV3 Picker] sendMessage response:", response);
          callback?.(response || { success: true });
          });
      });
    }

    function deactivate(callback?: (_response: any) => void) {
        if (tabId) {
      // Stop the overlay if present.
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            try {
            (globalThis as any).ubolOverlay?.stop?.();
            } catch (e) {
                console.warn('[uBR] pickerOverlay.stop: failed', e);
            }
        },
      }).catch((e) => {
          console.warn('[uBR] pickerDeactivate: executeScript failed for tab', tabId, e);
      });

      safeTabsSendMessage(tabId, { topic: "pickerDeactivate" }, () => {
          active = false;
          tabId = null;
          sessionId = null;
          if (callback) callback({ success: true });
      });
        } else {
            active = false;
            sessionId = null;
            if (callback) callback({ success: true });
        }
    }

    function isActive() {
        return active;
    }
    function getSessionId() {
        return sessionId;
    }
    function getTabId() {
        return tabId;
    }

    function createFilter(details: any, callback?: (_response: any) => void) {
        if (!tabId) {
            if (callback) callback({ error: "No active picker session" });
            return;
        }
        safeTabsSendMessage(tabId, { topic: "pickerCreateFilter", payload: details }, callback);
    }

  messaging.on("pickerLaunch", (payload, callback) => {
      activate(payload?.tabId ?? null, callback);
  });

  messaging.on("pickerQuery", (_, callback) => {
      if (callback) {
          callback({ active: isActive(), sessionId: getSessionId() });
      }
  });

  messaging.on("pickerCreateFilter", (payload, callback) => {
      createFilter(payload, callback);
  });

  messaging.on("pickerMessage", (payload, callback) => {
      const targetTab = zapper.isActive() ? zapper.getTabId() : getTabId();
      if (targetTab) {
          safeTabsSendMessage(
              targetTab,
              {
          topic: zapper.isActive() ? "zapperMessage" : "pickerMessage",
          payload,
              },
              callback,
          );
      } else if (callback) {
          callback({ error: "No active picker session" });
      }
  });

  messaging.on("elementPicker", (payload, callback) => {
      if (payload?.what === "elementPickerArguments") {
          const warSecret =
        (globalThis as any).vAPI?.warSecret?.short?.() ||
        Math.random().toString(36).slice(2, 10);
          callback({
        target: epickerArgs.target,
        mouse: epickerArgs.mouse,
        zap: epickerArgs.zap,
        pickerURL: `/web_accessible_resources/epicker-ui.html?zap=${warSecret}`,
        eprom: epickerArgs.eprom || null,
          });
          epickerArgs.target = "";
          epickerArgs.eprom = null;
      } else if (payload?.what === "elementPickerEprom") {
          const eprom = payload.eprom;
          if (eprom) {
              epickerArgs.eprom = eprom;
        chrome.storage.local.set({ elementPickerEprom: eprom }).catch((e) => {
          console.warn('[uBR] elementPickerEprom: storage.set failed', e);
        });
          }
          callback({ success: true });
      } else if (
          payload?.what === "createUserFilter" ||
      payload?.what === "elementPickerCreateFilter"
      ) {
          const filterText = String(payload.filter || payload.filters || "");
          const lines = filterText.split("\n").map(l => l.trim()).filter(Boolean);
          const smartLines: string[] = [];
          const networkLines: string[] = [];
          for (const line of lines) {
              if (line.startsWith("hide|") || line.startsWith("unhide|")) {
          smartLines.push(line);
                  networkLines.push(line);
              } else if (/##/.test(line)) {
                  const m = line.match(/^(.*?)(#@?#)(.+)$/);
                  if (m) {
                      const domain = m[1] || "*";
                      const isException = m[2] === "#@#";
                      const selector = m[3];
            smartLines.push(`${isException ? "unhide" : "hide"}|${domain}|${selector}`);
                  }
                  // Also store in userFilters for the standard DNR compilation pipeline
                  networkLines.push(line);
              } else {
          networkLines.push(line);
              }
          }
          if (smartLines.length > 0) {
              void (async () => {
                  try {
                      const { smartRuleStore } = await import("../../core/smart-cosmetic/smart-rule-store");
                      await smartRuleStore.load();
                      for (const line of smartLines) {
                          const parts = line.split("|");
                          const isUnhide = parts[0] === "unhide";
                          // Format: hide|domain|selector  or  hide|selector
                          const selector = parts[parts.length - 1];
                          const domain = parts.length > 2 ? parts.slice(1, -1).join("|") : "*";
                          if (!selector) continue;
                          const targets = domain === "*"
                              ? [{ form: "host" as const, value: "*" }]
                              : domain.split(",").filter(Boolean).map(d => ({ form: "host" as const, value: d }));
                          const rule = {
                type: isUnhide ? "show-exact" : "hide-exact" as const,
                id: `ubr:smart:picker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                syntaxVersion: 1,
                state: "active" as const,
                targets,
                selector,
                action: { action: isUnhide ? "show" : "hide" as const },
                metadata: { createdAt: new Date().toISOString(), source: "picker" as const },
                collectionId: "user-picker",
                          };
                          await smartRuleStore.addRule(rule as any);
                      }
                  } catch (e) {
            console.error("[sw-picker] Failed to create smart rule:", e);
                  }
              })();
          }
          if (networkLines.length > 0) {
        appendUserFilters(networkLines.join("\n"))
          .then((result) => callback(result))
          .catch((error) => {
            console.warn('[uBR] picker: appendUserFilters failed', error);
            callback({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
          } else {
              callback({ success: true });
          }
      } else {
          callback({});
      }
  });

  return {
    activate,
    deactivate,
    isActive,
    getSessionId,
    getTabId,
    createFilter,
  };
};
