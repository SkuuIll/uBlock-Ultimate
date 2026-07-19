/*******************************************************************************
 * uBlock Ultimate code viewer
 ******************************************************************************/

declare const CodeMirror: any;

declare const beautifier: {
    css(text: string, options: object): string;
    html(text: string, options: object): string;
    js(text: string, options: object): string;
};

declare const vAPI: {
    messaging?: {
        send(channel: string, message: object): Promise<any>;
    };
    defer?: {
        once(delay: number): Promise<unknown>;
    };
};

declare const uBlockDashboard: {
    patchCodeMirrorEditor?: (editor: any) => void;
};

type ResourceResult = {
    mime: string;
    text: string;
};

const query = <T extends Element>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (element === null) {
        throw new Error(`Code viewer is missing required element: ${selector}`);
    }
    return element;
};

const urlToDocMap = new Map<string, any>();
const params = new URLSearchParams(document.location.search);

let currentURL = '';

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_CACHED_DOCUMENTS = 20;

let activeFetchController: AbortController | null = null;
let loadGeneration = 0;

const editor = CodeMirror(query<HTMLElement>('#content'), {
    autofocus: true,
    gutters: ['CodeMirror-linenumbers'],
    lineNumbers: true,
    lineWrapping: true,
    maximizable: false,
    matchBrackets: true,
    styleActiveLine: {
        nonEmpty: true,
    },
});

uBlockDashboard?.patchCodeMirrorEditor?.(editor);

const normalizeMime = (value: string | null): string => {
    return (value || '')
        .replace(/\s*;.*$/, '')
        .trim()
        .toLowerCase();
};

const inferMimeFromURL = (url: string): string => {
    let pathname = '';
    try {
        pathname = new URL(url).pathname.toLowerCase();
    } catch {
        return '';
    }

    if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) {
        return 'application/javascript';
    }
    if (pathname.endsWith('.css')) {
        return 'text/css';
    }
    if (pathname.endsWith('.html') || pathname.endsWith('.htm')) {
        return 'text/html';
    }
    if (pathname.endsWith('.xml') || pathname.endsWith('.xhtml') || pathname.endsWith('.svg')) {
        return 'application/xml';
    }
    if (pathname.endsWith('.json')) {
        return 'application/json';
    }
    return '';
};

const beautifyResource = (text: string, mime: string): string => {
    const options = {
        end_with_newline: true,
        indent_size: 3,
        js: {
            max_preserve_newlines: 3,
        },
    };

    try {
        switch (mime) {
        case 'text/css':
            return beautifier.css(text, options);
        case 'text/html':
        case 'application/xhtml+xml':
        case 'application/xml':
        case 'text/xml':
        case 'image/svg+xml':
            return beautifier.html(text, options);
        case 'text/javascript':
        case 'application/javascript':
        case 'application/x-javascript':
            return beautifier.js(text, options);
        case 'application/json':
            try {
                return `${JSON.stringify(JSON.parse(text), null, 3)}\n`;
            } catch {
                return beautifier.js(text, options);
            }
        default:
            return text;
        }
    } catch (error) {
        console.warn('[uBR] Unable to beautify resource:', mime, error);
        return text;
    }
};

const readResponseText = async (
    response: Response,
    signal: AbortSignal,
): Promise<string> => {
    const declaredLength = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
        throw new Error(
            `Resource is too large to display: ${declaredLength} bytes`,
        );
    }

    if (response.body === null) {
        return response.text();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let text = '';

    for (;;) {
        if (signal.aborted) {
            throw new DOMException('Load aborted', 'AbortError');
        }

        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        total += value.byteLength;
        if (total > MAX_SOURCE_BYTES) {
            await reader.cancel();
            throw new Error(
                `Resource exceeds the ${MAX_SOURCE_BYTES}-byte viewer limit`,
            );
        }

        text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return text;
};

const fetchResource = async (
    url: string,
    signal: AbortSignal,
): Promise<ResourceResult> => {
    const options: RequestInit = {
        method: 'GET',
        referrer: '',
        signal,
    };

    if (urlToDocMap.has(url)) {
        options.cache = 'reload';
    }

    type AcquiredFetchRule = {
        ok: boolean;
        ruleId?: number;
    };

    let acquiredRuleId: number | undefined;
    let response: Response;
    try {
        const result = await vAPI.messaging?.send('codeViewer', {
            what: 'acquireFetchRule',
            url,
        }) as AcquiredFetchRule | undefined;

        if (result?.ok === true && Number.isInteger(result.ruleId)) {
            acquiredRuleId = result.ruleId;
        }

        response = await fetch(url, options);
    } catch (error) {
        if (
            error instanceof DOMException &&
            error.name === 'AbortError'
        ) {
            throw error;
        }
        return {
            mime: 'text/plain',
            text: `Unable to fetch resource:\n\n${url}\n\n${String(error)}`,
        };
    } finally {
        if (acquiredRuleId !== undefined) {
            await vAPI.messaging?.send('codeViewer', {
                what: 'releaseFetchRule',
                ruleId: acquiredRuleId,
            }).catch(() => {});
        }
    }

    let text: string;
    try {
        text = await readResponseText(response, signal);
    } catch (error) {
        if (
            error instanceof DOMException &&
            error.name === 'AbortError'
        ) {
            throw error;
        }
        text = `Unable to read response body:\n\n${url}\n\n${String(error)}`;
    }

    let mime = normalizeMime(response.headers.get('Content-Type'));
    if (mime === '' || mime === 'application/octet-stream') {
        mime = inferMimeFromURL(url) || 'text/plain';
    }

    if (!response.ok) {
        text = `HTTP ${response.status} ${response.statusText}\n${url}\n\n${text}`;
    }

    return { mime, text: beautifyResource(text, mime) };
};

const setEditorTheme = async (): Promise<void> => {
    let dark =
        document.documentElement.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;

    try {
        const response = await vAPI.messaging?.send('dom', { what: 'uiStyles' });
        const configuredTheme = response?.uiTheme;
        if (configuredTheme === 'dark') {
            dark = true;
        } else if (configuredTheme === 'light') {
            dark = false;
        }
    } catch (error) {
        console.warn('[uBR] Unable to retrieve code-viewer theme:', error);
    }

    editor.setOption('theme', dark ? 'night' : 'default');
};

const addPastURL = (url: string): void => {
    const list = query<HTMLElement>('#pastURLs');
    let current: HTMLElement | undefined;

    for (const child of Array.from(list.children)) {
        const item = child as HTMLElement;
        item.classList.remove('selected');
        if (item.textContent === url) {
            current = item;
        }
    }

    if (url === '') return;

    if (current === undefined) {
        current = document.createElement('span');
        current.textContent = url;
        list.prepend(current);
    }

    current.classList.add('selected');
};

const setInputURL = (url: string): void => {
    const input = query<HTMLInputElement>('#header input[type="url"]');
    if (input.value === url) return;
    input.value = url;
    input.setAttribute('value', url);
};

const swapDoc = (doc: any): any => {
    const previous = editor.swapDoc(doc);
    const searchThread = (self as any).searchThread;
    if (searchThread?.setHaystack instanceof Function) {
        searchThread.setHaystack(editor.getValue());
    }
    const searchInput = document.querySelector<HTMLInputElement>('.cm-search-widget-input input[type="search"]');
    if (searchInput?.value) {
        document.querySelector<HTMLElement>('.cm-search-widget')?.dispatchEvent(new Event('input'));
    }
    return previous;
};

const updateSourceLink = (url: string): void => {
    const link = document.querySelector<HTMLAnchorElement>('.cm-search-widget .sourceURL');
    if (link === null) return;
    link.href = url;
    link.title = url;
};

const focusEditorLater = (): void => {
    if (vAPI.defer?.once instanceof Function) {
        void vAPI.defer.once(1).then(() => { editor.focus(); });
        return;
    }
    setTimeout(() => { editor.focus(); }, 1);
};

const cacheDocument = (url: string, doc: any): void => {
    urlToDocMap.delete(url);
    urlToDocMap.set(url, doc);
    while (urlToDocMap.size > MAX_CACHED_DOCUMENTS + 1) {
        const oldest = urlToDocMap.keys().next().value;
        if (oldest === '') {
            const blank = urlToDocMap.get(oldest);
            urlToDocMap.delete(oldest);
            urlToDocMap.set(oldest, blank);
            continue;
        }
        urlToDocMap.delete(oldest);
    }
};

const setURL = async (resourceURL: string | null): Promise<void> => {
    const generation = ++loadGeneration;

    activeFetchController?.abort();
    const controller = new AbortController();
    activeFetchController = controller;

    resourceURL = resourceURL || '';

    if (/^(["']).+\1$/.test(resourceURL)) {
        resourceURL = resourceURL.slice(1, -1);
    }

    let normalizedURL = '';
    if (resourceURL !== '') {
        try {
            const parsed = new URL(resourceURL, currentURL || undefined);
            parsed.hash = '';
            normalizedURL = parsed.href;
        } catch {
            return;
        }
    }

    if (normalizedURL !== '' && !/^https?:\/\//i.test(normalizedURL)) {
        return;
    }

    if (normalizedURL === currentURL) {
        if (normalizedURL !== resourceURL) {
            setInputURL(normalizedURL);
        }
        return;
    }

    let documentForURL = urlToDocMap.get(normalizedURL);
    if (documentForURL === undefined) {
        const resource = await fetchResource(normalizedURL, controller.signal);
        if (generation !== loadGeneration || controller.signal.aborted) {
            return;
        }
        documentForURL = new CodeMirror.Doc(resource.text, resource.mime || 'text/plain');
        cacheDocument(normalizedURL, documentForURL);
    }

    swapDoc(documentForURL);
    currentURL = normalizedURL;
    setInputURL(normalizedURL);
    updateSourceLink(normalizedURL);
    addPastURL(normalizedURL);
    focusEditorLater();
};

const removeURL = (url: string): void => {
    if (url === '') return;
    const list = query<HTMLElement>('#pastURLs');
    const children = Array.from(list.children) as HTMLElement[];
    const index = children.findIndex(element => element.textContent === url);
    if (index === -1) return;

    children[index].remove();
    urlToDocMap.delete(url);

    const remaining = Array.from(list.children) as HTMLElement[];
    const nextIndex = Math.min(index, remaining.length - 1);
    const nextURL = nextIndex >= 0 ? remaining[nextIndex].textContent || '' : '';
    void setURL(nextURL);
};

editor.addOverlay({
    re: /\b(?:href|src)=["']([^"']+)["']/g,
    match: null,
    token(stream: any) {
        if (stream.sol()) {
            this.re.lastIndex = 0;
            this.match = this.re.exec(stream.string);
        }
        if (this.match === null) {
            stream.skipToEnd();
            return null;
        }
        const end = this.re.lastIndex - 1;
        const beginning = end - this.match[1].length;
        if (stream.pos < beginning) {
            stream.pos = beginning;
            return null;
        }
        if (stream.pos < end) {
            stream.pos = end;
            return 'href';
        }
        if (stream.pos < this.re.lastIndex) {
            stream.pos = this.re.lastIndex;
            this.match = this.re.exec(stream.string);
            return null;
        }
        stream.skipToEnd();
        return null;
    },
});

urlToDocMap.set('', editor.getDoc());

const reloadCurrentURL = async (): Promise<void> => {
    const input = query<HTMLInputElement>('#header input[type="url"]');
    const url = input.value;
    if (url === '') return;

    const generation = ++loadGeneration;
    activeFetchController?.abort();
    const controller = new AbortController();
    activeFetchController = controller;

    const previousDocument = swapDoc(new CodeMirror.Doc('', 'text/plain'));
    const resource = await fetchResource(url, controller.signal);
    if (generation !== loadGeneration || controller.signal.aborted || !urlToDocMap.has(url)) {
        swapDoc(previousDocument);
        return;
    }

    const newDocument = new CodeMirror.Doc(resource.text, resource.mime || 'text/plain');
    cacheDocument(url, newDocument);
    if (currentURL === url) {
        swapDoc(newDocument);
    }
};

const openEmbeddedResource = (target: HTMLElement): void => {
    const parts = [target.textContent || ''];
    let previous = target.previousSibling;
    while (previous instanceof HTMLElement && previous.classList.contains('cm-href')) {
        parts.unshift(previous.textContent || '');
        previous = previous.previousSibling;
    }
    let next = target.nextSibling;
    while (next instanceof HTMLElement && next.classList.contains('cm-href')) {
        parts.push(next.textContent || '');
        next = next.nextSibling;
    }
    void setURL(parts.join(''));
};

const start = async (): Promise<void> => {
    await setEditorTheme();

    const initialURL = params.get('url');
    await setURL(initialURL);

    query<HTMLInputElement>('#header input[type="url"]').addEventListener('change', event => {
        const input = event.currentTarget as HTMLInputElement;
        void setURL(input.value);
    });

    query<HTMLElement>('#reloadURL').addEventListener('click', () => {
        void reloadCurrentURL();
    });

    query<HTMLElement>('#removeURL').addEventListener('click', () => {
        const input = query<HTMLInputElement>('#header input[type="url"]');
        removeURL(input.value);
    });

    query<HTMLElement>('#pastURLs').addEventListener('mousedown', event => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('span');
        if (target === null) return;
        void setURL(target.textContent || '');
    });

    query<HTMLElement>('#content').addEventListener('click', event => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('.cm-href');
        if (target === null) return;
        openEmbeddedResource(target);
    });
};

void start()
    .catch(error => {
        console.error('[uBR] Code viewer initialization failed:', error);
        editor.setValue(`Code viewer initialization failed:\n\n${String(error)}`);
    })
    .finally(() => {
        document.body.classList.remove('loading');
    });
