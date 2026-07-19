(async function() {
  const main = document.getElementById("main");
  if (!main) return;

  const bar = document.createElement("div");
  bar.id = "newtab-toggle-bar";
  bar.innerHTML = '<span id="newtab-toggle" role="button" tabindex="0">&#8203;</span>';

  const style = document.createElement("style");
  style.textContent = [
    "#newtab-toggle-bar {",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: center;",
    "  padding: 6px 16px;",
    "  background: var(--popup-toolbar-surface, #f0f0f0);",
    "  border-bottom: 1px solid var(--border-1, #ccc);",
    "}",
    "#newtab-toggle {",
    "  cursor: pointer;",
    "  font-size: 12px;",
    "  padding: 4px 12px;",
    "  border-radius: 4px;",
    "  border: 1px solid var(--border-1, #ccc);",
    "  background: var(--surface-1, #fff);",
    "  color: var(--ink-1, #000);",
    "  user-select: none;",
    "}",
    "#newtab-toggle:hover {",
    "  background: var(--surface-2, #f0f0f0);",
    "}",
    "#newtab-toggle.off {",
    "  opacity: 0.5;",
    "}",
  ].join("\n");

  document.head.appendChild(style);
  main.insertBefore(bar, main.firstChild);

  const toggle = bar.querySelector("#newtab-toggle");

  async function send(msg) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ channel: "default", msg }, response => {
        if (chrome.runtime.lastError) {
          resolve({});
          return;
        }
        resolve(response || {});
      });
    });
  }

  async function refresh() {
    const r = await send({ what: "getNewtabToggle" });
    const enabled = r?.enabled === true;
    toggle.classList.toggle("off", !enabled);
    toggle.title = enabled ? "Disable custom new tab" : "Enable custom new tab";
    toggle.textContent = enabled ? "Custom New Tab: ON" : "Custom New Tab: OFF";
  }

  toggle.addEventListener("click", async () => {
    const enabled = !toggle.classList.contains("off");
    await send({ what: "setNewtabToggle", enabled: !enabled });
    await refresh();
  });

  await refresh();
})();
