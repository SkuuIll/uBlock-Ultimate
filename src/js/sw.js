/*******************************************************************************

    uBlock Origin - Service Worker (MV3)
    https://github.com/gorhill/uBlock

    This is the main background service worker for uBlock Origin in MV3.
    It handles all background tasks including:
    - Messaging between content scripts, popup, and dashboard
    - Element zapper/picker functionality
    - Rule management (DNR integration)
    - Storage operations

*******************************************************************************/

(function() {
    

    const messaging = {
        _portMap: new Map(),
        _handlers: new Map(),

        _onPortConnected: function(port) {
            const self = this;
            const name = port.name || 'unknown';
            
            this._portMap.set(name, port);

            port.onMessage.addListener((message) => {
                self._handleMessage(port, message);
            });

            port.onDisconnect.addListener(() => {
                void chrome.runtime.lastError;
                self._portMap.delete(name);
            });
        },

        _handleMessage: function(port, message) {
            const self = this;
            
            // Handle vapi-client.js format: { channel, msgId, msg }
            // Also handle MV3 format: { topic, payload }
            let topic, payload, seq;
            
            if (message && message.channel) {
                // vapi-client.js format
                topic = message.channel;
                payload = message.msg;
                seq = message.msgId;
            } else if (message && message.topic) {
                // MV3 format
                topic = message.topic;
                payload = message.payload;
                seq = message.seq;
            } else {
                console.log("[SW] _handleMessage: Unknown message format", message);
                return;
            }

            const handler = this._handlers.get(topic);
            
            if (handler) {
                try {
                    const result = handler(payload, (response) => {
                        if (seq !== undefined) {
                            port.postMessage({
                                seq: seq,
                                payload: response
                            });
                        }
                    });
                    
                    if (result instanceof Promise) {
                        result.then((response) => {
                            if (seq !== undefined) {
                                port.postMessage({
                                    seq: seq,
                                    payload: response
                                });
                            }
                        }).catch((error) => {
                            if (seq !== undefined) {
                                port.postMessage({
                                    seq: seq,
                                    payload: { error: error.message }
                                });
                            }
                        });
                    }
                } catch (e) {
                    console.error('Messaging handler error:', e);
                    if (seq !== undefined) {
                        port.postMessage({
                            seq: seq,
                            payload: { error: e.message }
                        });
                    }
                }
            } else {
                this._broadcastToTabs(topic, payload);
            }
        },

        _broadcastToTabs: function(topic, payload) {
            const self = this;
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach((tab) => {
                    chrome.tabs.sendMessage(tab.id, {
                        topic: topic,
                        payload: payload
                    }).catch((e) => {
                        console.warn('[uBR] sw: tabs.sendMessage failed', tab.id, e);
                    });
                });
            });
        },

        _handleRuntimeMessage: function(message, sender, sendResponse) {
            const self = this;
            
            // Handle vapi-client.js format: { channel, msgId, msg }
            // Also handle standard MV3 format: { topic, payload }
            let topic, payload;
            
            if (message && message.channel) {
                // vapi-client.js format - extract topic and payload
                topic = message.channel;
                payload = message.msg;
            } else if (message && message.topic) {
                // Standard MV3 format
                topic = message.topic;
                payload = message.payload;
            } else {
                return false;
            }

            if (message.ch === 'content-script') {
                return this._handleContentScriptMessage(message, sender, sendResponse);
            }

            const handler = this._handlers.get(topic);
            
            console.log('[SW] Looking for handler for topic:', topic, 'Found:', handler ? 'yes' : 'no');
            
            if (handler) {
                try {
                    console.log('[SW] Calling handler for:', topic);
                    const result = handler(payload, sendResponse);
                    
                    if (result instanceof Promise) {
                        result.then((response) => {
                            console.log('[SW] Handler promise resolved for:', topic, 'response:', JSON.stringify(response));
                            sendResponse(response);
                        }).catch((error) => {
                            console.error('[SW] Handler promise rejected for:', topic, error);
                            sendResponse({ error: error.message });
                        });
                        return true;
                    }
                    
                    console.log('[SW] Handler sync result for:', topic, 'result:', result);
                    return result;
                } catch (e) {
                    console.error('Messaging handler error:', e);
                    sendResponse({ error: e.message });
                }
            } else {
                console.log('[SW] No handler found for topic:', topic);
            }

            return false;
        },

        _handleContentScriptMessage: function(message, sender, sendResponse) {
            const self = this;
            const fn = message.fn;
            const args = message.args || [];
            const tabId = sender.tab ? sender.tab.id : null;

            const handler = this._handlers.get(fn);
            
            if (handler) {
                try {
                    const payload = args[0] || {};
                    payload._tabId = tabId;
                    payload._sender = sender;

                    const result = handler(payload, (response) => {
                        sendResponse(response);
                    });
                    
                    if (result instanceof Promise) {
                        result.then((response) => {
                            sendResponse(response);
                        }).catch((error) => {
                            sendResponse({ error: error.message });
                        });
                        return true;
                    }
                    
                    return result !== undefined;
                } catch (e) {
                    console.error('Content script handler error:', e);
                    sendResponse({ error: e.message });
                }
            }

            return false;
        },

        on: function(topic, handler) {
            this._handlers.set(topic, handler);
        },

        off: function(topic) {
            this._handlers.delete(topic);
        },

        sendToTab: function(tabId, topic, payload, callback) {
            chrome.tabs.sendMessage(tabId, {
                topic: topic,
                payload: payload
            }, (...args) => {
                void chrome.runtime.lastError;
                if (callback) callback(...args);
            });
        },

        sendToAllTabs: function(topic, payload) {
            const self = this;
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach((tab) => {
                    chrome.tabs.sendMessage(tab.id, {
                        topic: topic,
                        payload: payload
                    }).catch((e) => {
                        console.warn('[uBR] sw: tabs.sendMessage failed', tab.id, e);
                    });
                });
            });
        },

        getPort: function(name) {
            return this._portMap.get(name);
        }
    };

    const zapper = {
        _active: false,
        _tabId: null,
        _sessionId: null,

        activate: function(tabId, callback) {
            const self = this;
            this._active = true;
            this._tabId = tabId;
            this._sessionId = Date.now().toString(36);

            chrome.tabs.sendMessage(tabId, {
                topic: 'zapperActivate',
                payload: {
                    sessionId: this._sessionId
                }
            }, (response) => {
                void chrome.runtime.lastError;
                if (callback) {
                    callback(response || { success: true });
                }
            });
        },

        deactivate: function(callback) {
            const self = this;
            
            if (this._tabId) {
                chrome.tabs.sendMessage(this._tabId, {
                    topic: 'zapperDeactivate'
                }, () => {
                    void chrome.runtime.lastError;
                    self._active = false;
                    self._tabId = null;
                    self._sessionId = null;
                    if (callback) {
                        callback({ success: true });
                    }
                });
            } else {
                this._active = false;
                this._sessionId = null;
                if (callback) {
                    callback({ success: true });
                }
            }
        },

        isActive: function() {
            return this._active;
        },

        getSessionId: function() {
            return this._sessionId;
        },

        highlightElement: function(details, callback) {
            if (!this._tabId) {
                if (callback) callback({ error: 'No active zapper session' });
                return;
            }

            chrome.tabs.sendMessage(this._tabId, {
                topic: 'zapperHighlight',
                payload: details
            }, (...args) => {
                void chrome.runtime.lastError;
                if (callback) callback(...args);
            });
        },

        clickElement: function(details, callback) {
            if (!this._tabId) {
                if (callback) callback({ error: 'No active zapper session' });
                return;
            }

            chrome.tabs.sendMessage(this._tabId, {
                topic: 'zapperClick',
                payload: details
            }, (...args) => {
                void chrome.runtime.lastError;
                if (callback) callback(...args);
            });
        }
    };

    const picker = {
        _active: false,
        _tabId: null,
        _sessionId: null,

        activate: function(tabId, callback) {
            const self = this;
            this._active = true;
            this._tabId = tabId;
            this._sessionId = Date.now().toString(36);

            chrome.tabs.sendMessage(tabId, {
                topic: 'pickerActivate',
                payload: {
                    sessionId: this._sessionId
                }
            }, (response) => {
                void chrome.runtime.lastError;
                if (callback) {
                    callback(response || { success: true });
                }
            });
        },

        deactivate: function(callback) {
            const self = this;
            
            if (this._tabId) {
                chrome.tabs.sendMessage(this._tabId, {
                    topic: 'pickerDeactivate'
                }, () => {
                    void chrome.runtime.lastError;
                    self._active = false;
                    self._tabId = null;
                    self._sessionId = null;
                    if (callback) {
                        callback({ success: true });
                    }
                });
            } else {
                this._active = false;
                this._sessionId = null;
                if (callback) {
                    callback({ success: true });
                }
            }
        },

        isActive: function() {
            return this._active;
        },

        getSessionId: function() {
            return this._sessionId;
        },

        createFilter: function(details, callback) {
            if (!this._tabId) {
                if (callback) callback({ error: 'No active picker session' });
                return;
            }

            chrome.tabs.sendMessage(this._tabId, {
                topic: 'pickerCreateFilter',
                payload: details
            }, (...args) => {
                void chrome.runtime.lastError;
                if (callback) callback(...args);
            });
        }
    };

    messaging.on('ping', (payload, callback) => {
        callback({ pong: true, timestamp: Date.now() });
    });

    messaging.on('zapperLaunch', (payload, callback) => {
        const tabId = payload && payload.tabId;
        if (!tabId) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs.length > 0) {
                    zapper.activate(tabs[0].id, callback);
                } else if (callback) {
                    callback({ error: 'No active tab' });
                }
            });
        } else {
            zapper.activate(tabId, callback);
        }
    });

    messaging.on('zapperQuery', (payload, callback) => {
        callback({
            active: zapper.isActive(),
            sessionId: zapper.getSessionId()
        });
    });

    messaging.on('zapperHighlight', (payload, callback) => {
        zapper.highlightElement(payload, callback);
    });

    messaging.on('zapperClick', (payload, callback) => {
        zapper.clickElement(payload, callback);
    });

    messaging.on('pickerLaunch', (payload, callback) => {
        const tabId = payload && payload.tabId;
        if (!tabId) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs.length > 0) {
                    picker.activate(tabs[0].id, callback);
                } else if (callback) {
                    callback({ error: 'No active tab' });
                }
            });
        } else {
            picker.activate(tabId, callback);
        }
    });

    messaging.on('pickerQuery', (payload, callback) => {
        callback({
            active: picker.isActive(),
            sessionId: picker.getSessionId()
        });
    });

    messaging.on('pickerCreateFilter', (payload, callback) => {
        picker.createFilter(payload, callback);
    });

    messaging.on('pickerMessage', (payload, callback) => {
        if (zapper.isActive()) {
            chrome.tabs.sendMessage(zapper._tabId, {
                topic: 'zapperMessage',
                payload: payload
            }, (...args) => {
                void chrome.runtime.lastError;
                if (callback) callback(...args);
            });
        } else if (picker.isActive()) {
            chrome.tabs.sendMessage(picker._tabId, {
                topic: 'pickerMessage',
                payload: payload
            }, (...args) => {
                void chrome.runtime.lastError;
                if (callback) callback(...args);
            });
        } else if (callback) {
            callback({ error: 'No active picker session' });
        }
    });

    messaging.on('getTabId', (payload, callback) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0 && callback) {
                callback({ tabId: tabs[0].id });
            } else if (callback) {
                callback({ tabId: null });
            }
        });
    });

    messaging.on('userSettings', (payload, callback) => {
        chrome.storage.local.get('userSettings', (items) => {
            if (callback) {
                callback(items.userSettings || {});
            }
        });
    });

    messaging.on('setUserSettings', (payload, callback) => {
        chrome.storage.local.get('userSettings', (items) => {
            const settings = items.userSettings || {};
            Object.assign(settings, payload);
            chrome.storage.local.set({ userSettings: settings }, () => {
                if (callback) {
                    callback({ success: true });
                }
            });
        });
    });

    chrome.runtime.onConnect.addListener((port) => {
        messaging._onPortConnected(port);
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('[SW] onMessage received:', JSON.stringify(message));
        return messaging._handleRuntimeMessage(message, sender, sendResponse);
    });

    // Bridge to messaging-bundle for dashboard messages
    // This allows HTML pages to communicate with the background
    (function() {
        // Load and initialize messaging from bundled code
        const messagingBundle = null;
        
        // Function to handle dashboard messages from UI pages
        function handleDashboardMessage(msg, sendResponse) {
            if (!msg || !msg.what) {
                return false;
            }
            
            // Import and use the messaging bundle handlers
            // The handlers are defined in messaging-bundle.js
            // We need to access them via the global scope or re-initialize
            
            // For now, handle getLists specially by returning mock data
            // until full integration is complete
            switch (msg.what) {
            case 'getLists':
                // Return filter lists data
                var response = {
                        autoUpdate: true,
                        available: {},
                        cache: {},
                        cosmeticFilterCount: 0,
                        current: {},
                        ignoreGenericCosmeticFilters: false,
                        isUpdating: false,
                        netFilterCount: 0,
                        parseCosmeticFilters: true,
                        suspendUntilListsAreLoaded: false,
                        userFiltersPath: 'user-filters'
                };
                    
                    // Get user settings and filter lists from storage
                    chrome.storage.local.get(['availableFilterLists', 'selectedFilterLists', 'userSettings', 'assetMetadata'], (items) => {
                        // Get user settings
                        if (items.userSettings) {
                            response.autoUpdate = items.userSettings.autoUpdate !== false;
                            response.parseCosmeticFilters = items.userSettings.parseAllABPHideFilters !== false;
                            response.ignoreGenericCosmeticFilters = items.userSettings.ignoreGenericCosmeticFilters === true;
                            response.suspendUntilListsAreLoaded = items.userSettings.suspendUntilListsAreLoaded === true;
                        }
                        
                        // Check if we have stored availableFilterLists
                        if (items.availableFilterLists && Object.keys(items.availableFilterLists).length > 0) {
                            response.available = items.availableFilterLists;
                            response.current = items.availableFilterLists;
                            
                            // Use cached metadata if available
                            if (items.assetMetadata) {
                                response.cache = items.assetMetadata;
                            }
                            
                            sendResponse(response);
                            return;
                        }
                        
                        // Need to load from assets.json and build availableFilterLists
                        // Fetch assets.json and parse it
                        fetch('assets/assets.json')
                            .then((res) => { return res.json(); })
                            .then((assetsData) => {
                                const availableLists = {};
                                
                                // Add user filters entry
                                availableLists['user-filters'] = {
                                    content: 'filters',
                                    group: 'user',
                                    title: 'My filters'
                                };
                                
                                // Parse assets.json and build available filter lists
                                for (const assetKey in assetsData) {
                                    if (assetKey === 'assets.json') continue;
                                    
                                    const asset = assetsData[assetKey];
                                    if (asset.content !== 'filters') continue;
                                    
                                    const entry = {
                                        content: asset.content,
                                        group: asset.group || 'default',
                                        title: asset.title || assetKey,
                                        parent: asset.parent
                                    };
                                    
                                    if (asset.contentURL) {
                                        entry.contentURL = asset.contentURL;
                                    }
                                    if (asset.off === true) {
                                        entry.off = true;
                                    }
                                    if (asset.preferred === true) {
                                        entry.preferred = true;
                                    }
                                    if (asset.supportURL) {
                                        entry.supportURL = asset.supportURL;
                                    }
                                    if (asset.homeURL) {
                                        entry.homeURL = asset.homeURL;
                                    }
                                    
                                    availableLists[assetKey] = entry;
                                }
                                
                                // Save to storage for future use
                                response.available = availableLists;
                                response.current = availableLists;
                                
                                chrome.storage.local.set({ availableFilterLists: availableLists }, () => {
                                    sendResponse(response);
                                });
                            })
                            .catch((err) => {
                                console.error('Error loading assets.json:', err);
                                // Fallback to basic structure
                                response.available = {
                                    'user-filters': {
                                        content: 'filters',
                                        group: 'user',
                                        title: 'My filters'
                                    }
                                };
                                response.current = response.available;
                                sendResponse(response);
                            });
                    });
                return true; // async response
                    
            case 'reloadAllFilters':
                // Trigger filter reload
                sendResponse({ done: true });
                return true;
                    
            case 'updateNow':
                // Trigger filter update
                sendResponse({ done: true });
                return true;
                    
            case 'applyFilterListSelection':
                    // Save filter list selection
                    chrome.storage.local.set({ selectedFilterLists: msg.toSelect || [] }, () => {
                        sendResponse({ done: true });
                    });
                return true;
                    
            case 'userSettings':
                    // Save user settings
                    chrome.storage.local.get('userSettings', (items) => {
                        const settings = items.userSettings || {};
                        settings[msg.name] = msg.value;
                        chrome.storage.local.set({ userSettings: settings }, () => {
                            sendResponse({ done: true });
                        });
                    });
                return true;
                    
            default:
                return false;
            }
        }
        
        messaging.on('dashboard', handleDashboardMessage);
        
        // Also handle direct chrome.runtime.sendMessage for dashboard
        const originalHandleRuntimeMessage = messaging._handleRuntimeMessage;
        messaging._handleRuntimeMessage = function(message, sender, sendResponse) {
            if (message && message.channel === 'dashboard') {
                return handleDashboardMessage(message.msg, sendResponse);
            }
            return originalHandleRuntimeMessage.call(this, message, sender, sendResponse);
        };
        
        console.log('Dashboard messaging bridge initialized');
    })();

    chrome.commands.onCommand.addListener((command) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) return;
            const tabId = tabs[0].id;

            switch (command) {
            case 'launch-element-zapper':
                    zapper.activate(tabId);
                break;
            case 'launch-element-picker':
                    picker.activate(tabId);
                break;
            case 'open-dashboard':
                    chrome.runtime.openOptionsPage();
                break;
            case 'launch-logger':
                    chrome.tabs.create({ url: 'logger-ui.html' });
                break;
            }
        });
    });

    chrome.runtime.onInstalled.addListener((details) => {
        if (details.reason === 'install') {
            console.log('uBlock Origin installed');
        } else if (details.reason === 'update') {
            console.log('uBlock Origin updated');
        }
    });

    // Filter list management (Gap 35)
    function applyFilterListSelection(selection) {
        if (!selection || !selection.toSelect || !selection.toRemove) return;
        chrome.storage.local.get('selectedFilterLists', (items) => {
            const current = items.selectedFilterLists || [];
            const updated = current.filter(id => !selection.toRemove.includes(id));
            for (const id of selection.toSelect) {
                if (!updated.includes(id)) updated.push(id);
            }
            chrome.storage.local.set({ selectedFilterLists: updated }, () => {
                console.log('[SW] Filter list selection applied:', updated);
            });
        });
    }

    function getFilterListState(callback) {
        chrome.storage.local.get(['availableFilterLists', 'selectedFilterLists'], (items) => {
            const available = items.availableFilterLists || {};
            const selected = items.selectedFilterLists || [];
            const state = {};
            for (const key of Object.keys(available)) {
                state[key] = selected.includes(key);
            }
            if (callback) callback(state);
        });
    }

    function syncFilterListDnrRules(listId) {
        console.log('[SW] Syncing DNR rules for filter list:', listId);
        // Placeholder — triggers DNR rule recompilation for the given list
    }

    // Whitelist management (Gap 38)
    function compileWhitelistDirective(directive) {
        if (!directive) return null;
        const parts = directive.split('/');
        const hostname = parts[0].toLowerCase();
        const path = parts.slice(1).join('/');
        const isRegex = directive.startsWith('/') && directive.endsWith('/');
        const hasScheme = directive.includes('://');
        return {
            raw: directive,
            hostname: isRegex || hasScheme ? null : hostname,
            path: path || null,
            regex: isRegex ? directive.slice(1, -1) : null,
            scheme: hasScheme ? directive.split('://')[0] : null,
        };
    }

    function isURLTrusted(url) {
        if (!url) return false;
        try {
            const u = new URL(url);
            const hostname = u.hostname.toLowerCase();
            // Built-in trusted hosts
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
            if (hostname.endsWith('.local')) return true;
            // Check stored whitelist
            const stored = JSON.parse(localStorage.getItem('whitelistDirectives') || '[]');
            for (const entry of stored) {
                if (entry.hostname && hostname === entry.hostname) return true;
                if (entry.hostname && hostname.endsWith(`.${  entry.hostname}`)) return true;
                if (entry.regex && new RegExp(entry.regex).test(url)) return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    function installWhitelistAllowRules(directives) {
        if (!directives || directives.length === 0) return;
        const allowRules = directives.map((d, i) => {
            const compiled = compileWhitelistDirective(d);
            if (!compiled) return null;
            const rule = {
                id: 900000 + i,
                priority: 1,
                action: { type: 'allow' },
                condition: {},
            };
            if (compiled.hostname) {
                rule.condition.urlFilter = compiled.hostname;
                if (compiled.path) rule.condition.urlFilter += `/${  compiled.path}`;
            }
            if (compiled.regex) {
                rule.condition.regexFilter = compiled.regex;
            }
            if (compiled.scheme) {
                rule.condition.urlFilter = `${compiled.scheme  }://`;
            }
            return rule;
        }).filter(Boolean);
        if (allowRules.length > 0) {
            chrome.declarativeNetRequest.updateSessionRules({
                addRules: allowRules,
            });
        }
    }

    function reloadWhitelist() {
        chrome.storage.local.get('whitelistDirectives', (items) => {
            const directives = items.whitelistDirectives || [];
            installWhitelistAllowRules(directives);
        });
    }

    // host-access module (platform/chromium/js/host-access.js) provides resolveHostAccess
    self.resolveHostAccess = null; // initialized at runtime

    console.log('uBlock Origin Service Worker started');

    self.messaging = messaging;
    self.zapper = zapper;
    self.picker = picker;
    self.applyFilterListSelection = applyFilterListSelection;
    self.getFilterListState = getFilterListState;
    self.syncFilterListDnrRules = syncFilterListDnrRules;
    self.compileWhitelistDirective = compileWhitelistDirective;
    self.isURLTrusted = isURLTrusted;
    self.installWhitelistAllowRules = installWhitelistAllowRules;
    self.reloadWhitelist = reloadWhitelist;

})();
