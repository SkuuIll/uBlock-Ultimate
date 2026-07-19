(() => {
  // codemirror/search-thread.ts
  (function() {
      if (self.WorkerGlobalScope instanceof Object && self instanceof self.WorkerGlobalScope) {
          let content = "";
          const doSearch = function(details) {
              const reEOLs = /\n\r|\r\n|\n|\r/g;
              const t1 = Date.now() + 750;
              let reSearch;
              try {
                  reSearch = new RegExp(details.pattern, details.flags);
              } catch {
                  return [];
              }
              const response = [];
              const maxOffset = content.length;
              let iLine = 0;
              let iOffset = 0;
              let size = 0;
              while (iOffset < maxOffset) {
                  const match = reSearch.exec(content);
                  if (match === null) {
                      break;
                  }
                  reEOLs.lastIndex = 0;
                  const eols = content.slice(iOffset, match.index).match(reEOLs);
                  if (Array.isArray(eols)) {
                      iLine += eols.length;
                  }
          response.push(iLine);
          size += 1;
          reEOLs.lastIndex = reSearch.lastIndex;
          const eol = reEOLs.exec(content);
          iOffset = eol !== null ? reEOLs.lastIndex : content.length;
          reSearch.lastIndex = iOffset;
          iLine += 1;
          if ((size & 1023) === 0 && Date.now() >= t1) {
              break;
          }
              }
              return response;
          };
          self.onmessage = function(e) {
              const msg = e.data;
              switch (msg.what) {
              case "setHaystack":
                  content = msg.content;
                  break;
              case "doSearch": {
                  const searchMsg = msg;
                  const response = doSearch(searchMsg);
            self.postMessage({ id: searchMsg.id, response });
            break;
              }
              default:
                  break;
              }
          };
          return;
      }
      {
          const workerTTL = { min: 5 };
          const pendingResponses = /* @__PURE__ */ new Map();
          const workerTTLTimer = vAPI.defer.create(() => {
              shutdown();
          });
          let worker;
          let messageId = 1;
          const onWorkerMessage = function(e) {
              const msg = e.data;
              const resolver = pendingResponses.get(msg.id);
              if (resolver === void 0) {
                  return;
              }
        pendingResponses.delete(msg.id);
        resolver(msg.response);
          };
          const cancelPendingTasks = function() {
              for (const resolver of pendingResponses.values()) {
                  resolver();
              }
        pendingResponses.clear();
          };
          const destroy = function() {
              shutdown();
              self.searchThread = void 0;
          };
          const shutdown = function() {
              if (worker === void 0) {
                  return;
              }
        workerTTLTimer.off();
        worker.terminate();
        worker.onmessage = null;
        worker = void 0;
        cancelPendingTasks();
          };
          const init = function() {
              if (self.searchThread instanceof Object === false) {
                  return;
              }
              if (worker === void 0) {
                  worker = new Worker("js/codemirror/search-thread.js");
                  worker.onmessage = onWorkerMessage;
              }
        workerTTLTimer.offon(workerTTL);
          };
          const needHaystack = function() {
              return worker instanceof Object === false;
          };
          const setHaystack = function(content) {
              init();
        worker.postMessage({ what: "setHaystack", content });
          };
          const search = function(query, overwrite = true) {
              init();
              if (worker instanceof Object === false) {
                  return Promise.resolve();
              }
              if (overwrite) {
                  cancelPendingTasks();
              }
              const id = messageId++;
        worker.postMessage({
          what: "doSearch",
          id,
          pattern: query.source,
          flags: query.flags,
          isRE: query instanceof RegExp
        });
        return new Promise((resolve) => {
          pendingResponses.set(id, resolve);
        });
          };
      self.addEventListener(
          "beforeunload",
          () => {
              destroy();
          },
          { once: true }
      );
      self.searchThread = { needHaystack, setHaystack, search, shutdown };
      }
  })();
})();
