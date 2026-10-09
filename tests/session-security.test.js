const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
function declaration(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    const asyncStart = source.slice(start - 6, start) === 'async ' ? start - 6 : start;
    return source.slice(asyncStart, source.indexOf('\n}', start) + 2);
}
function storage() {
    const data = new Map();
    return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function context(base = 'https://api.example.test', page = 'https://app.example.test/') {
    const localStorage = storage(), sessionStorage = storage();
    const location = new URL(page);
    const calls = [], alerts = [];
    const sandbox = {
        URL, AbortSignal, localStorage, sessionStorage, scheduleInterval: null,
        requestAnimationFrame() {},
        window: { API_BASE_URL: base, location }, confirm: () => true,
        alert: message => alerts.push(message),
        document: {
            getElementById: () => null, querySelector: () => null,
            querySelectorAll: () => [], body: { classList: { add() {}, remove() {} } }
        },
        fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200 }; },
        getAppMode: () => 'graduacao',
        stopPollingProgress() {}, hideQueueDisplay() {}, stopClassProgressBarUpdates() {},
        restoreLoginForm() {}, closeProfileLogin() {},
        stopTokenTimer() {}, atualizarSelectPerfisSalvos() {}, updateComparisonToggleState() {},
        atualizarPainelSemDadosParaModo() {}, applyDesktopProfileSelectVisibility() {}
    };
    vm.createContext(sandbox);
    vm.runInContext(source.slice(0, source.indexOf('const STORAGE_LAST_CONSULTA')), sandbox);
    vm.runInContext(`
        const STORAGE_SAVED_PROFILES = 'sigaaPerfisSalvos';
        const STORAGE_SELECTED_PROFILE = 'sigaaPerfilSelecionado';
        const STORAGE_COMPARISON_MODE = 'sigaaComparisonMode';
        ${declaration('clearStoredTokenInfo')}
        ${declaration('executarLogoutAction')}
    `, sandbox);
    return { sandbox, localStorage, sessionStorage, calls, alerts };
}

test('HTTPS failure makes one request and never falls back to HTTP', async () => {
    const { sandbox, calls } = context('https://api.example.test', 'http://localhost:3000/');
    sandbox.fetch = async (url, options) => { calls.push({ url, options }); throw new TypeError('offline'); };
    await assert.rejects(sandbox.fetchApi('/api/scraper', { method: 'POST', body: 'token' }));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith('https://'));
    assert.equal(calls[0].options.redirect, 'error');
});

test('remote HTTP is blocked before sending credentials; local HTTP works only from a local page', async () => {
    for (const [base, page] of [
        ['http://api.example.test', 'http://localhost:3000/'],
        ['http://127.0.0.1:3000', 'https://app.example.test/']
    ]) {
        const { sandbox, calls } = context(base, page);
        await assert.rejects(sandbox.fetchApi('/api/login', { method: 'POST', body: 'credentials' }));
        assert.equal(calls.length, 0);
    }
    const local = context('http://localhost:3000', 'http://localhost:3000/');
    await local.sandbox.fetchApi('/api/login', { method: 'POST' });
    assert.equal(local.calls.length, 1);
});

test('logout waits for server confirmation before deleting local tokens and data', async () => {
    const { sandbox, localStorage, calls } = context();
    localStorage.setItem('sigaa_token', 'test-token');
    localStorage.setItem('sigaaUltimaConsulta', 'private-data');
    let resolve;
    sandbox.fetch = (url, options) => {
        calls.push({ url, options });
        return new Promise(done => { resolve = done; });
    };
    const pending = sandbox.executarLogoutAction();
    assert.equal(localStorage.getItem('sigaa_token'), 'test-token');
    assert.equal(localStorage.getItem('sigaaUltimaConsulta'), 'private-data');
    resolve({ ok: true, status: 200 });
    await pending;
    assert.equal(localStorage.getItem('sigaa_token'), null);
    assert.equal(localStorage.getItem('sigaaUltimaConsulta'), null);
    assert.equal(JSON.parse(calls[0].options.body).token, 'test-token');
    assert.equal(vm.runInContext('__sessionVersion', sandbox), 1);
});

test('logout outage preserves the session and allows retry', async () => {
    const { sandbox, localStorage, alerts } = context();
    localStorage.setItem('sigaa_token', 'test-token');
    sandbox.fetch = async () => ({ ok: false, status: 503 });
    await sandbox.executarLogoutAction();
    assert.equal(localStorage.getItem('sigaa_token'), 'test-token');
    assert.equal(alerts.length, 1);
    assert.equal(vm.runInContext('__logoutInProgress', sandbox), false);
    sandbox.fetch = async () => ({ ok: true, status: 200 });
    await sandbox.executarLogoutAction();
    assert.equal(localStorage.getItem('sigaa_token'), null);
});

test('logout covers legacy storage, deduplicates tokens, and clears already invalid tokens', async () => {
    const { sandbox, localStorage, sessionStorage, calls } = context();
    localStorage.setItem('sigaa_token', 'first');
    localStorage.setItem('sigaa_token_info', JSON.stringify({ token: 'first' }));
    sessionStorage.setItem('sigaa_token_info', JSON.stringify({ token: 'second' }));
    sandbox.fetch = async (url, options) => { calls.push({ url, options }); return { ok: false, status: 401 }; };
    await sandbox.executarLogoutAction();
    assert.deepEqual(calls.map(call => JSON.parse(call.options.body).token), ['first', 'second']);
    assert.equal(localStorage.getItem('sigaa_token'), null);
    assert.equal(sessionStorage.getItem('sigaa_token_info'), null);
});
