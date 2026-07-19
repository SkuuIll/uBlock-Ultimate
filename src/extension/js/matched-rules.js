(() => {
  // src/js/matched-rules.ts
  (function() {
      
      const API = {
      getMatchedRuleInfo: function(tabId) {
          return vAPI.messaging.send("dashboard", {
          what: "getMatchedRuleInfo",
          tabId,
          sinceMs: 3e5
          });
      }
      };
      const matchedRulesBody = document.getElementById("matchedRulesBody");
      const emptyState = document.getElementById("emptyState");
      const refreshBtn = document.getElementById("refreshBtn");
      const clearBtn = document.getElementById("clearBtn");
      const statusSpan = document.getElementById("status");
      function formatTime(timestamp) {
          const date = new Date(timestamp);
          return date.toLocaleTimeString();
      }
      function getActionClass(action) {
          if (action === "block") return "rule-blocked";
          if (action === "allow") return "rule-allowed";
          return "rule-info";
      }
      function renderMatchedRules(rules) {
          matchedRulesBody.innerHTML = "";
          if (!rules || rules.length === 0) {
              emptyState.style.display = "block";
        document.getElementById("matchedRulesList").style.display = "none";
        return;
          }
          emptyState.style.display = "none";
      document.getElementById("matchedRulesList").style.display = "table";
      for (const rule of rules) {
          const row = document.createElement("tr");
          const action = rule.compiledAction || "unknown";
          const actionClass = getActionClass(action);
          row.innerHTML = `
                <td>${formatTime(rule.timeStamp)}</td>
                <td>${rule.sourceList || "unknown"}</td>
                <td>${rule.sourceLine || "-"}</td>
                <td title="${rule.originalFilter || ""}">${rule.originalFilter || "-"}</td>
                <td>${rule.rulesetId || "unknown"}:${rule.ruleId || "-"}</td>
                <td class="${actionClass}">${action}</td>
            `;
        matchedRulesBody.appendChild(row);
      }
      statusSpan.textContent = `${rules.length} rules`;
      }
      async function refresh() {
          try {
              statusSpan.textContent = "Loading...";
              const result = await API.getMatchedRuleInfo();
              if (!result || result.ok !== true) {
                  renderMatchedRules([]);
                  statusSpan.textContent = result?.reason || "Rule ID unknown";
                  return;
              }
              renderMatchedRules(result.matches);
          } catch (e) {
        console.error("Failed to get matched rules:", e);
        statusSpan.textContent = "Error loading rules";
          }
      }
    refreshBtn.addEventListener("click", refresh);
    clearBtn.addEventListener("click", () => {
        renderMatchedRules([]);
        statusSpan.textContent = "";
    });
    statusSpan.textContent = "Click refresh";
  })();
})();
