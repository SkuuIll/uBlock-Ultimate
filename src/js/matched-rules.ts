/*******************************************************************************

    uBlock Ultimate - Matched Rules UI Script
    Copyright (C) 2024-present Raymond Hill

    This script powers the matched-rules.html page to display
    recent tab-level DNR attribution evidence.

******************************************************************************/

(function() {
    

    const API = {
        getMatchedRuleInfo: function(tabId) {
            return vAPI.messaging.send('dashboard', {
                what: 'getMatchedRuleInfo',
                tabId: tabId,
                sinceMs: 300000
            });
        }
    };

    const matchedRulesBody = document.getElementById('matchedRulesBody');
    const emptyState = document.getElementById('emptyState');
    const refreshBtn = document.getElementById('refreshBtn');
    const clearBtn = document.getElementById('clearBtn');
    const statusSpan = document.getElementById('status');

    function formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString();
    }

    function getActionClass(action) {
        if (action === 'block') return 'rule-blocked';
        if (action === 'allow') return 'rule-allowed';
        return 'rule-info';
    }

    function renderMatchedRules(rules) {
        matchedRulesBody.innerHTML = '';

        if (!rules || rules.length === 0) {
            emptyState.style.display = 'block';
            document.getElementById('matchedRulesList').style.display = 'none';
            return;
        }

        emptyState.style.display = 'none';
        document.getElementById('matchedRulesList').style.display = 'table';

        for (const rule of rules) {
            const row = document.createElement('tr');
            
            const action = rule.compiledAction || 'unknown';
            const actionClass = getActionClass(action);

            const tdTime = document.createElement('td');
            tdTime.textContent = formatTime(rule.timeStamp);
            const tdList = document.createElement('td');
            tdList.textContent = rule.sourceList || getMsg('unknown') || 'unknown';
            const tdLine = document.createElement('td');
            tdLine.textContent = rule.sourceLine || '-';
            const tdFilter = document.createElement('td');
            tdFilter.textContent = rule.originalFilter || '-';
            tdFilter.title = rule.originalFilter || '';
            const tdRule = document.createElement('td');
            tdRule.textContent = `${rule.rulesetId || getMsg('unknown') || 'unknown'}:${rule.ruleId || '-'}`;
            const tdAction = document.createElement('td');
            tdAction.className = actionClass;
            tdAction.textContent = action;

            row.append(tdTime, tdList, tdLine, tdFilter, tdRule, tdAction);
            
            matchedRulesBody.appendChild(row);
        }

        const countMsg = getMsg('matchedRulesCountLabel');
        statusSpan.textContent = countMsg
            ? countMsg.replace('{{count}}', String(rules.length))
            : `${rules.length} rules`;
    }

    function getMsg(key) {
        try { if (typeof chrome !== 'undefined' && chrome.i18n) return chrome.i18n.getMessage(key); } catch(_) {}
        try { if (typeof browser !== 'undefined' && browser.i18n) return browser.i18n.getMessage(key); } catch(_) {}
        return '';
    }

    async function refresh() {
        try {
            statusSpan.textContent = getMsg('matchedRulesLoading') || 'Loading...';
            const result = await API.getMatchedRuleInfo();
            if (!result || result.ok !== true) {
                renderMatchedRules([]);
                statusSpan.textContent = result?.reason || getMsg('matchedRulesUnknownId') || 'Rule ID unknown';
                return;
            }
            renderMatchedRules(result.matches);
        } catch (e) {
            console.error('Failed to get matched rules:', e);
            statusSpan.textContent = getMsg('matchedRulesError') || 'Error loading rules';
        }
    }

    refreshBtn.addEventListener('click', refresh);
    clearBtn.addEventListener('click', () => {
        renderMatchedRules([]);
        statusSpan.textContent = '';
    });

    statusSpan.textContent = getMsg('matchedRulesClickRefresh') || 'Click refresh';
})();
