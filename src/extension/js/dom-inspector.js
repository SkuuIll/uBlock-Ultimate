(() => {
  // dom-inspector.ts
  const svgRoot = document.querySelector("svg");
  let inspectorContentPort;
  const shutdown = () => {
    inspectorContentPort.close();
    inspectorContentPort.onmessage = inspectorContentPort.onmessageerror = null;
    inspectorContentPort = void 0;
  };
  const contentInspectorChannel = (ev) => {
      const msg = ev.data || {};
      switch (msg.what) {
      case "quitInspector": {
          shutdown();
          break;
      }
      case "svgPaths": {
          const paths = svgRoot.children;
        paths[0].setAttribute("d", msg.paths[0]);
        paths[1].setAttribute("d", msg.paths[1]);
        paths[2].setAttribute("d", msg.paths[2]);
        paths[3].setAttribute("d", msg.paths[3]);
        break;
      }
      default:
          break;
      }
  };
  globalThis.addEventListener("message", (ev) => {
      const msg = ev.data || {};
      if (msg.what !== "startInspector") {
          return;
      }
      if (Array.isArray(ev.ports) === false) {
          return;
      }
      if (ev.ports.length === 0) {
          return;
      }
      inspectorContentPort = ev.ports[0];
      inspectorContentPort.onmessage = contentInspectorChannel;
      inspectorContentPort.onmessageerror = shutdown;
    inspectorContentPort.postMessage({ what: "startInspector" });
  }, { once: true });
})();
