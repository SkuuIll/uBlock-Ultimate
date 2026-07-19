(() => {
  // scriptlets/should-inject-contentscript.ts
  (() => {
      try {
          const status = vAPI?.uBR !== true;
          if (status === false && vAPI?.bootstrap) {
        self.requestIdleCallback?.(() => vAPI?.bootstrap?.());
          }
          return status;
      } catch(e) {
          console.warn('[uBlock Ultimate] should-inject-contentscript: status check failed', e);
          return true;
      }
  })();
})();
