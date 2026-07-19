var vAPI = vAPI || {};
vAPI.uBR = true;
vAPI.T0 = Date.now();
vAPI.sessionId = Math.random().toString(36).slice(2, 18);

vAPI.randomToken = function() {
    const n = Math.random();
    return String.fromCharCode(n * 25 + 97) +
        Math.floor((0.25 + n * 0.75) * Number.MAX_SAFE_INTEGER).toString(36).slice(-8);
};

vAPI.shutdown = {
    jobs: [],
    add: function(job) { this.jobs.push(job); },
    exec: function() {
        self.requestIdleCallback(() => {
            const jobs = this.jobs.slice();
            this.jobs.length = 0;
            while (jobs.length !== 0) { (jobs.pop())(); }
        });
    },
    remove: function(job) {
        let pos;
        while ((pos = this.jobs.indexOf(job)) !== -1) { this.jobs.splice(pos, 1); }
    }
};

vAPI.setTimeout = function(fn, delay) { return setTimeout(fn, delay); };
vAPI.getURL = function(path) { return (self.browser || self.chrome).runtime.getURL(path); };
vAPI.closePopup = function() {};

vAPI.messaging = {
    send: function(channelName, request) {
        return new Promise((resolve) => {
            const webextAPI = self.browser || self.chrome;
            const p = webextAPI.runtime.sendMessage({
                channel: channelName,
                msg: request
            }, (response) => {
                void webextAPI.runtime.lastError;
                resolve(response);
            });
            p?.catch((e) => { console.warn('[uBlock Ultimate] vapi-content: runtime.sendMessage failed', e); });
        });
    }
};

vAPI.localStorage = {
    getItemAsync: function(key) { return Promise.resolve(null); },
    setItemAsync: function(key, value) { return Promise.resolve(); }
};

vAPI.userStylesheet = {
    added: new Set(),
    removed: new Set(),
    apply: function(callback) {
        if (this.added.size === 0 && this.removed.size === 0) { return; }
        const added = Array.from(this.added);
        const removed = Array.from(this.removed);
        this.added.clear();
        this.removed.clear();
        
        vAPI.messaging.send('vapi', {
            what: 'userCSS',
            add: added,
            remove: removed,
        }).then(() => {
            if (callback instanceof Function) { callback(); }
        }).catch(e => {
            console.warn('[uBlock Ultimate] vapi-content: userCSS send failed', e);
            if (callback instanceof Function) { callback(); }
        });
    },
    add: function(cssText, now) {
        if (cssText === '') { return; }
        this.added.add(cssText);
        if (now) { this.apply(); }
    },
    remove: function(cssText, now) {
        if (cssText === '') { return; }
        this.removed.add(cssText);
        if (now) { this.apply(); }
    }
};
