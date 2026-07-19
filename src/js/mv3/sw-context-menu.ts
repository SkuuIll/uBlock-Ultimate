/*******************************************************************************

    uBlock Origin - MV3 Context Menu
    https://github.com/gorhill/uBlock

    This file contains context menu functionality.

*******************************************************************************/

export const createContextMenu = (userSettings: {
  contextMenuEnabled?: boolean;
}) => {
    if (typeof chrome.contextMenus === "undefined") {
    console.log("[MV3] chrome.contextMenus not available");
    return;
    }

  chrome.contextMenus.removeAll(() => {
      if (userSettings.contextMenuEnabled === false) {
          return;
      }
    chrome.contextMenus.create(
        {
        id: "uBlock0-blockElement",
        title: chrome.i18n.getMessage("pickerContextMenuEntry") || "Block element...",
        contexts: ["all"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
        },
        () => {
        console.log("[MV3] Context menu created");
        },
    );
  });
};

export const setupContextMenuListener = () => {
    if (typeof chrome.contextMenus === "undefined") {
    console.log("[MV3] chrome.contextMenus not available");
    return;
    }

  chrome.contextMenus.onClicked?.addListener(async (details, tab) => {
      if (details.menuItemId === "uBlock0-blockElement" && tab) {
          const tabId = tab.id;
          if (typeof tabId !== "number") {
              return;
          }

      console.log("[MV3] Context menu clicked - tabId:", tabId);

      try {
          // Use the same approach as popup picker - inject scripts directly into page
          // This is the proper MV3 way and matches what popup-picker.ts does
          await chrome.scripting.executeScript({
          target: { tabId },
          files: ["/js/scripting/tool-overlay.js", "/js/scripting/picker.js"],
          });
        console.log("[MV3] Picker scripts injected successfully");
      } catch (e) {
        console.error("[MV3] Error launching picker:", e);
      }
      }
  });
};

export const initContextMenu = (userSettings: {
  contextMenuEnabled?: boolean;
}) => {
    createContextMenu(userSettings);
    setupContextMenuListener();
};
