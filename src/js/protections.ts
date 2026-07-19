type Risk = 'low' | 'medium' | 'high';

interface ProtectionRuleset {
    id: string;
    enabled: boolean;
    ruleCount: number;
    risk: Risk;
    title: { en: string; es: string };
    description: { en: string; es: string };
}

interface ProtectionState {
    availableStaticRuleCount: number | null;
    rulesets: ProtectionRuleset[];
}

const spanish = navigator.language.toLowerCase().startsWith('es');
const language = spanish ? 'es' : 'en';

const text = spanish
    ? {
        title: 'Protecciones opcionales',
        description: 'Activa sólo las capas que necesites. Los cambios se aplican de forma atómica mediante DNR.',
        capacity: 'Capacidad disponible',
        enabled: 'Activado',
        disabled: 'Desactivado',
        rules: 'reglas',
        loading: 'Cargando protecciones…',
        saved: 'Protección actualizada.',
        error: 'No se pudo aplicar el cambio.',
        risks: { low: 'Bajo riesgo', medium: 'Precaución', high: 'Alto riesgo' },
    }
    : {
        title: 'Optional protections',
        description: 'Enable only the layers you need. Changes are applied atomically through DNR.',
        capacity: 'Available capacity',
        enabled: 'Enabled',
        disabled: 'Disabled',
        rules: 'rules',
        loading: 'Loading protections…',
        saved: 'Protection updated.',
        error: 'The change could not be applied.',
        risks: { low: 'Low risk', medium: 'Caution', high: 'High risk' },
    };

function query<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (element === null) throw new Error(`Missing UI element: ${selector}`);
    return element;
}

async function send<T>(message: Record<string, unknown>): Promise<T> {
    const response = await chrome.runtime.sendMessage({
        channel: 'dashboard',
        msg: message,
    }) as T | { error?: unknown } | undefined;
    if (response === undefined) throw new Error('The service worker did not respond');
    if (
        typeof response === 'object' &&
        response !== null &&
        'error' in response &&
        typeof response.error === 'string'
    ) {
        throw new Error(response.error);
    }
    return response as T;
}

function updateHeader(state: ProtectionState): void {
    query('#page-title').textContent = text.title;
    query('#page-description').textContent = text.description;
    query('#quota-label').textContent = text.capacity;
    query('#quota-value').textContent = state.availableStaticRuleCount === null
        ? '—'
        : state.availableStaticRuleCount.toLocaleString();
}

function render(state: ProtectionState): void {
    updateHeader(state);
    const list = query<HTMLElement>('#ruleset-list');
    const template = query<HTMLTemplateElement>('#ruleset-template');
    list.replaceChildren();
    list.setAttribute('aria-busy', 'false');

    for (const ruleset of state.rulesets) {
        const fragment = template.content.cloneNode(true) as DocumentFragment;
        const card = fragment.querySelector<HTMLElement>('.ruleset-card');
        const input = fragment.querySelector<HTMLInputElement>('input');
        const label = fragment.querySelector<HTMLElement>('.switch-label');
        if (card === null || input === null || label === null) continue;

        card.dataset.rulesetId = ruleset.id;
        const title = fragment.querySelector<HTMLElement>('h2');
        const description = fragment.querySelector<HTMLElement>('.ruleset-description');
        const meta = fragment.querySelector<HTMLElement>('.ruleset-meta');
        const risk = fragment.querySelector<HTMLElement>('.risk-badge');
        if (title) title.textContent = ruleset.title[language];
        if (description) description.textContent = ruleset.description[language];
        if (meta) meta.textContent = `${ruleset.ruleCount.toLocaleString()} ${text.rules} · ${ruleset.id}`;
        if (risk) risk.textContent = text.risks[ruleset.risk];

        input.checked = ruleset.enabled;
        input.setAttribute('aria-label', ruleset.title[language]);
        label.textContent = ruleset.enabled ? text.enabled : text.disabled;
        input.addEventListener('change', async () => {
            input.disabled = true;
            const status = query<HTMLElement>('#status');
            status.textContent = '';
            status.classList.remove('error');
            try {
                const next = await send<ProtectionState>({
                    what: 'setProtectionRuleset',
                    id: ruleset.id,
                    enabled: input.checked,
                });
                render(next);
                status.textContent = text.saved;
            } catch (error) {
                input.checked = !input.checked;
                input.disabled = false;
                status.classList.add('error');
                status.textContent = `${text.error} ${error instanceof Error ? error.message : String(error)}`;
            }
        });
        list.append(fragment);
    }
}

async function start(): Promise<void> {
    query('#page-title').textContent = text.title;
    query('#page-description').textContent = text.description;
    query('#quota-label').textContent = text.capacity;
    query('#status').textContent = text.loading;
    try {
        render(await send<ProtectionState>({ what: 'getProtectionRulesets' }));
        query('#status').textContent = '';
        document.body.dataset.ready = 'true';
    } catch (error) {
        const status = query<HTMLElement>('#status');
        status.classList.add('error');
        status.textContent = `${text.error} ${error instanceof Error ? error.message : String(error)}`;
    }
}

void start();
