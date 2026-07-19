import { dom, qs$, qsa$ } from './dom.js';

interface RuleEntry {
  id: string;
  type: string;
  state: string;
  targets: { form: string; value: string }[];
  selector?: string;
  collectionId?: string;
}

interface CollectionEntry {
  id: string;
  sourceUrl?: string;
  metadata?: { listId?: string; updatedAt?: string };
  lastUpdateCheck?: number;
  lastUpdateSuccess?: number;
  updateError?: string;
}

let currentRules: RuleEntry[] = [];
let currentCollections: CollectionEntry[] = [];
let editingRuleId: string | null = null;

async function loadRules(): Promise<void> {
    const response = await vAPI.messaging.send('dashboard', { what: 'getSmartRules' });
    currentRules = response.rules || [];
    currentCollections = response.collections || [];
    renderRules();
    renderCollections();
    updateStats();
}

function renderRules(filter?: string): void {
    const list = qs$('#ruleList')!;
    const empty = qs$('#noRules')!;

    let items = currentRules;
    if (filter) {
        const lower = filter.toLowerCase();
        items = items.filter(r =>
      r.selector?.toLowerCase().includes(lower) ||
      r.targets.some(t => t.value.includes(lower)) ||
      r.type.includes(lower)
        );
    }

    if (items.length === 0) {
        list.innerHTML = '';
    dom.show(empty);
    return;
    }

  dom.hide(empty);
  list.innerHTML = items.map(r => `
    <div class="rule-item state-${r.state}">
      <div class="rule-info">
        <div class="rule-type">${r.type}</div>
        <div class="rule-target">${r.targets.map(t => `${t.form}:${t.value}`).join(', ')}</div>
        <div class="rule-selector">${r.selector || r.collectionId || ''}</div>
      </div>
      <div class="rule-actions">
        <button class="toggle-rule iconified" data-id="${r.id}" data-state="${r.state}" type="button">
          <span class="fa-icon">${r.state === 'enabled' ? 'toggle-on' : 'toggle-off'}</span>
        </button>
        <button class="edit-rule iconified" data-id="${r.id}" type="button">
          <span class="fa-icon">pencil</span>
        </button>
        <button class="delete-rule iconified" data-id="${r.id}" type="button">
          <span class="fa-icon">trash</span>
        </button>
      </div>
    </div>
  `).join('');
}

function renderCollections(): void {
    const list = qs$('#collectionList')!;
    if (currentCollections.length === 0) {
        list.innerHTML = '<div class="empty-state" data-i18n="smartRulesNoCollections"></div>';
        return;
    }

    list.innerHTML = currentCollections.map(c => `
    <div class="collection-item">
      <div class="col-header">
        <span class="col-name">${c.metadata?.listId || c.id}</span>
        <span class="col-status">${c.updateError ? 'Error' : c.lastUpdateSuccess ? 'Synced' : 'Pending'}</span>
      </div>
      ${c.sourceUrl ? `<div class="col-source">${c.sourceUrl}</div>` : ''}
      ${c.updateError ? `<div class="col-error">${c.updateError}</div>` : ''}
      ${c.lastUpdateCheck ? `<div class="col-status">Last check: ${new Date(c.lastUpdateCheck).toLocaleString()}</div>` : ''}
    </div>
  `).join('');
}

function updateStats(): void {
    const enabled = currentRules.filter(r => r.state === 'enabled').length;
    const total = currentRules.length;
  qs$('#ruleStats')!.textContent = `${enabled}/${total} enabled, ${currentCollections.length} collections`;
}

async function toggleRule(id: string, currentState: string): Promise<void> {
    const newState = currentState === 'enabled' ? 'disabled' : 'enabled';
    await vAPI.messaging.send('dashboard', { what: 'setSmartRuleState', id, state: newState });
    await loadRules();
}

async function deleteRule(id: string): Promise<void> {
    await vAPI.messaging.send('dashboard', { what: 'removeSmartRule', id });
    await loadRules();
}

function openEditor(rule?: RuleEntry): void {
    editingRuleId = rule?.id || null;
  qs$('#editorTitle')!.textContent = rule ? 'Edit Rule' : 'Add Rule';
  qs$('#editorType')!.value = rule?.type || 'hide-exact';
  qs$('#editorTargets')!.value = rule?.targets.map(t => `${t.form}:${t.value}`).join(', ') || '';
  qs$('#editorSelector')!.value = rule?.selector || '';
  qs$('#editorState')!.value = rule?.state || 'enabled';
  dom.show(qs$('#ruleEditor')!);
}

function closeEditor(): void {
  dom.hide(qs$('#ruleEditor')!);
  editingRuleId = null;
}

async function saveRule(): Promise<void> {
    const type = (qs$('#editorType') as HTMLSelectElement).value;
    const targetsStr = (qs$('#editorTargets') as HTMLInputElement).value;
    const selector = (qs$('#editorSelector') as HTMLInputElement).value;
    const state = (qs$('#editorState') as HTMLSelectElement).value;

    const targets = targetsStr.split(',').map(s => {
        const trimmed = s.trim();
        const colonIdx = trimmed.indexOf(':');
        return colonIdx !== -1
            ? { form: trimmed.substring(0, colonIdx).trim(), value: trimmed.substring(colonIdx + 1).trim() }
            : { form: 'host', value: trimmed };
    }).filter(t => t.value);

    if (targets.length === 0) return;

    const ruleData: any = {
    type,
    targets,
    selector: selector || undefined,
    state,
    syntaxVersion: 1,
    action: { action: type === 'smart-allow' ? 'unhide' : 'hide' },
    };

    if (editingRuleId) {
        ruleData.id = editingRuleId;
        await vAPI.messaging.send('dashboard', { what: 'updateSmartRule', rule: ruleData });
    } else {
        await vAPI.messaging.send('dashboard', { what: 'addSmartRule', rule: ruleData });
    }

    closeEditor();
    await loadRules();
}

function initTabs(): void {
    const tabs = qsa$('.tab');
    for (const tab of tabs) {
    dom.on(tab, 'click', () => {
      qsa$('.tab').forEach(t => dom.cl.remove(t, 'active'));
      dom.cl.add(tab, 'active');
      qsa$('.pane').forEach(p => dom.cl.remove(p, 'active'));
      const paneId = `pane-${dom.attr(tab, 'data-pane')}`;
      dom.cl.add(qs$(`#${paneId}`)!, 'active');
    });
    }
}

function initSearch(): void {
    const input = qs$('#ruleSearch') as HTMLInputElement;
    if (!input) return;
  dom.on(input, 'input', () => renderRules(input.value));
}

function initTester(): void {
    const btn = qs$('#testerBtn');
    const urlInput = qs$('#testerUrl') as HTMLInputElement;
    const results = qs$('#testerResults')!;

  dom.on(btn!, 'click', async () => {
      const url = urlInput.value;
      if (!url) return;

      const response = await vAPI.messaging.send('dashboard', {
      what: 'testSmartRules',
      url,
      });

      results.innerHTML = (response.selectors || []).map((s: string) =>
          `<div class="tester-result-item">${s}</div>`
      ).join('') || '<div data-i18n="smartRulesNoResults"></div>';
  });
}

function initImportExport(): void {
    const importBtn = qs$('#importBtn')!;
    const importYaml = qs$('#importYaml') as HTMLTextAreaElement;
    const importStatus = qs$('#importStatus')!;

  dom.on(importBtn, 'click', async () => {
      const yaml = importYaml.value.trim();
      if (!yaml) {
          importStatus.textContent = 'Please paste YAML rules first.';
          importStatus.className = 'import-status error';
          return;
      }

      importStatus.textContent = 'Importing...';
      importStatus.className = 'import-status';
    importBtn.setAttribute('disabled', 'true');

    const response = await vAPI.messaging.send('dashboard', {
      what: 'importSmartRules',
      yaml,
    });

    importBtn.removeAttribute('disabled');

    if (response.ok) {
        importStatus.textContent = `Imported ${response.count} rule(s) successfully.`;
        importStatus.className = 'import-status success';
        importYaml.value = '';
        await loadRules();
    } else {
        const errors = response.errors || ['Import failed'];
        importStatus.textContent = `Error: ${errors.join('; ')}`;
        importStatus.className = 'import-status error';
    }
  });

  const exportYamlBtn = qs$('#exportYamlBtn')!;
  const exportClassicBtn = qs$('#exportClassicBtn')!;
  const exportOutput = qs$('#exportOutput') as HTMLTextAreaElement;
  const exportStats = qs$('#exportStats')!;
  const copyBtn = qs$('#copyExportBtn')!;
  const copyStatus = qs$('#copyStatus')!;

  dom.on(exportYamlBtn, 'click', async () => {
      const result = await vAPI.messaging.send('dashboard', { what: 'exportSmartRules' });
      if (result.yaml) {
          exportOutput.value = result.yaml;
          exportStats.innerHTML = `Total: ${result.totalRules} rules | Lossless: ${result.losslessCount} | Partial: ${result.partialCount} | Approximate: ${result.approximateCount} | Not possible: ${result.notPossibleCount}`;
          copyStatus.textContent = '';
      } else {
          exportOutput.value = 'No rules to export.';
      }
  });

  dom.on(exportClassicBtn, 'click', async () => {
      const result = await vAPI.messaging.send('dashboard', { what: 'exportSmartRulesToClassic' });
      if (result.classicLines && result.classicLines.length > 0) {
          exportOutput.value = result.classicLines.join('\n');
          const lossCount = result.lossMetadata.filter((l: any) => l.code !== 'lossless').length;
          exportStats.innerHTML = `${result.classicLines.length} lines exported | ${lossCount} rule(s) with data loss`;
          copyStatus.textContent = '';
      } else {
          exportOutput.value = 'No classic-compatible rules to export.';
          exportStats.innerHTML = '';
      }
  });

  dom.on(copyBtn, 'click', async () => {
      const text = exportOutput.value;
      if (!text) {
          copyStatus.textContent = 'Nothing to copy.';
          copyStatus.className = 'copy-status error';
          return;
      }
      try {
          await navigator.clipboard.writeText(text);
          copyStatus.textContent = 'Copied!';
          copyStatus.className = 'copy-status success';
      } catch(e) {
      console.warn('[uBR] smart-rules: clipboard write failed', e);
      exportOutput.select();
      document.execCommand('copy');
      copyStatus.textContent = 'Copied!';
      copyStatus.className = 'copy-status success';
      }
  });
}

async function init(): Promise<void> {
    initTabs();
    initSearch();
    initTester();
    initImportExport();

  dom.on(qs$('#addRuleBtn')!, 'click', () => openEditor());
  dom.on(qs$('#addCollectionBtn')!, 'click', async () => {
      const url = prompt('Collection URL:');
      if (!url) return;
      await vAPI.messaging.send('dashboard', { what: 'subscribeSmartCollection', url });
      await loadRules();
  });
  dom.on(qs$('#refreshBtn')!, 'click', loadRules);
  dom.on(qs$('#editorSave')!, 'click', saveRule);
  dom.on(qs$('#editorCancel')!, 'click', closeEditor);
  dom.on(qs$('#editorClose')!, 'click', closeEditor);

  dom.on(document, 'click', (e: Event) => {
      const target = e.target as HTMLElement;
      const btn = target.closest('[data-id]') as HTMLElement | null;
      if (!btn) return;

      if (dom.cl.has(btn, 'toggle-rule')) {
          toggleRule(btn.dataset.id!, btn.dataset.state!);
      } else if (dom.cl.has(btn, 'edit-rule')) {
          const rule = currentRules.find(r => r.id === btn.dataset.id);
          if (rule) openEditor(rule);
      } else if (dom.cl.has(btn, 'delete-rule')) {
          deleteRule(btn.dataset.id!);
      }
  });

  await loadRules();
}

init();
