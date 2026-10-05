// Run with Node.js and Playwright available through NODE_PATH if needed.
// The fixture server never starts the Google Sheets background loader.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const server = spawn(process.env.PYTHON || 'python3', ['-u', '-c', `
import runpy
from app import SearchCache, create_app
from werkzeug.serving import make_server
snapshot = runpy.run_path('tests/test_app.py')['snapshot']
cache = SearchCache(loader=snapshot)
assert cache.refresh_once()
app = create_app(cache=cache, start_cache_on_request=False)
server = make_server('127.0.0.1', 0, app)
print('UI_TEST_URL=http://127.0.0.1:' + str(server.server_port), flush=True)
server.serve_forever()
`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

async function serverUrl() {
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => reject(new Error('UI fixture server timed out: ' + stderr)), 10000);
        server.stdout.on('data', chunk => {
            stdout += chunk;
            const match = stdout.match(/UI_TEST_URL=(http:\/\/127\.0\.0\.1:\d+)/);
            if (match) {
                clearTimeout(timer);
                resolve(match[1]);
            }
        });
        server.stderr.on('data', chunk => { stderr += chunk; });
        server.once('error', err => { clearTimeout(timer); reject(err); });
        server.once('exit', code => {
            clearTimeout(timer);
            reject(new Error(`UI fixture server exited (${code}): ${stderr}`));
        });
    });
}

async function submit(page, query, viaEnter = false) {
    await page.getByRole('textbox', { name: 'Артикул для поиска' }).fill(query);
    if (viaEnter) await page.locator('#partNumber').press('Enter');
    else await page.getByRole('button', { name: 'Найти' }).click();
}

async function assertContained(page) {
    const overflow = await page.evaluate(() => ({
        viewport: window.innerWidth,
        width: document.documentElement.scrollWidth,
        overflowing: [...document.querySelectorAll('main *')].filter(node => {
            const box = node.getBoundingClientRect();
            return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1);
        }).map(node => node.id || node.className)
    }));
    assert.ok(overflow.width <= overflow.viewport, JSON.stringify(overflow));
    assert.deepEqual(overflow.overflowing, []);
}

async function checkShell(page, pagePath) {
    await page.goto(pagePath);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole('heading', { name: 'Поиск аналогов', exact: true }).waitFor();
    assert.match(await page.locator('.subtitle').innerText(), /Дворники и тормозные колодки/);
    assert.equal(await page.locator('.category-nav [aria-current="page"]').getAttribute('href'), pagePath);
    for (const id of ['recent', 'notFound']) {
        assert.equal(await page.locator('#' + id).isVisible(), false);
        assert.equal(await page.locator('#' + id).evaluate(node => node.getBoundingClientRect().height), 0);
    }
    assert.equal(await page.locator('#favorites, #favoriteInput').count(), 0);
    assert.equal(await page.locator('#notifications').getAttribute('role'), 'status');
    assert.equal(await page.locator('#notifications').evaluate(node => node.getBoundingClientRect().height), 0);
    assert.equal(await page.locator('#partNumber').getAttribute('aria-describedby'), 'searchTips');
    assert.equal(await page.locator('#searchBtn').getAttribute('type'), 'submit');
    await assertContained(page);
}

async function checkErrors(page, endpoint) {
    const before = await page.locator('#recentContent').innerText();
    let calls = 0;
    let mode = 400;
    await page.route('**' + endpoint, route => {
        calls += 1;
        if (mode === 'network') return route.abort();
        if (mode === 'invalid-json') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>error</html>' });
        return route.fulfill({ status: mode, json: { error: 'English server message' } });
    });
    await submit(page, '');
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#errorText').innerText(), 'Введите артикул для поиска.');
    assert.equal(calls, 0);
    for (const [status, expected] of [
        [400, /Проверьте артикул/],
        [503, /База поиска ещё загружается/],
        [500, /Не удалось выполнить поиск/],
        ['network', /Проверьте подключение к сети/],
        ['invalid-json', /Не удалось получить результаты/]
    ]) {
        mode = status;
        await submit(page, 'ERR-100');
        await page.locator('#error').waitFor({ state: 'visible' });
        assert.match(await page.locator('#errorText').innerText(), expected);
        assert.equal(await page.locator('#loading').isVisible(), false);
        assert.equal(await page.locator('#results').isVisible(), false);
    }
    assert.equal(calls, 5);
    assert.equal(await page.locator('#recentContent').innerText(), before);
    await page.unroute('**' + endpoint);
}

const recentKey = 'part-search:recent:v1';
const favoritesKey = 'part-search:favorites:v1';
const notFoundKey = 'part-search:not-found:v1';

async function stored(page, key) {
    return page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
}

async function complete(page, query) {
    await submit(page, query);
    await page.locator('#results').waitFor({ state: 'visible' });
}

async function checkPersonalLists(page, pagePath) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(pagePath);
    const endpoint = pagePath === '/' ? '/search' : '/search-brake-pads';
    const query = pagePath === '/' ? 'W1-ALT' : 'P-ALT';
    await complete(page, query);
    await page.reload();
    assert.equal(await page.locator('#recentContent .personal-search').innerText(), query);
    await page.locator('#recentContent').getByRole('button', { name: query, exact: true }).click();
    await page.waitForFunction(([key, query]) => JSON.parse(localStorage.getItem(key)).items[0].display === query, [recentKey, query]);
    await complete(page, query.toLowerCase().replace('-', ' . '));
    assert.equal((await stored(page, recentKey)).items.filter(item => item.key === query.replace('-', '')).length, 1);
    assert.equal((await stored(page, recentKey)).items[0].display, query.toLowerCase().replace('-', ' . '));

    // Deterministic valid empty responses cover the history limit in both modes.
    await page.route('**' + endpoint, route => route.fulfill({ json: { results: [] } }));
    await page.route('**/search-prefix', route => route.fulfill({ json: { results: [] } }));
    for (let i = 0; i < 22; i += 1) await complete(page, 'HISTORY-' + i);
    let history = (await stored(page, recentKey)).items;
    assert.equal(history.length, 20);
    assert.equal(history[0].display, 'HISTORY-21');
    assert.equal(history[19].display, 'HISTORY-2');
    await complete(page, 'history . 3');
    history = (await stored(page, recentKey)).items;
    assert.equal(history.length, 20);
    assert.equal(history[0].display, 'history . 3');
    // Other symbols remain meaningful under the existing normalization rule.
    await complete(page, 'HISTORY/3');
    assert.equal((await stored(page, recentKey)).items[0].key, 'HISTORY/3');
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#clearRecent').click();
    assert.equal((await stored(page, recentKey)).items.length, 20);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#clearRecent').click();
    assert.equal((await stored(page, recentKey)).items.length, 0);
    assert.equal(await page.locator('#recent').isVisible(), false);
    await page.unroute('**' + endpoint);
    await page.unroute('**/search-prefix');

    // A 2xx malformed response is an error, not a completed search.
    await page.route('**' + endpoint, route => route.fulfill({ json: { error: 'Invalid payload' } }));
    await submit(page, 'BAD-PAYLOAD');
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.equal((await stored(page, recentKey)).items.length, 0);
    await page.unroute('**' + endpoint);

    for (const corrupt of ['{broken', JSON.stringify({ version: 2, items: [] }), JSON.stringify({ version: 1, items: {} })]) {
        await page.evaluate(([key, value]) => localStorage.setItem(key, value), [recentKey, corrupt]);
        await page.reload();
        assert.equal(await page.locator('#recent').isVisible(), false);
        await complete(page, query);
        assert.equal((await stored(page, recentKey)).items.length, 1);
    }
    await page.evaluate(([recentKey, favoritesKey]) => {
        localStorage.setItem(recentKey, JSON.stringify({ version: 1, items: [
            { key: 'REAL1', display: 'Real-1' }, { key: 'REAL1', display: 'REAL.1' },
            { key: 'WRONG', display: 'Other' }, null, { display: 1 }
        ] }));
        localStorage.setItem(favoritesKey, '{broken');
    }, [recentKey, favoritesKey]);
    await page.reload();
    assert.deepEqual(await page.locator('#recentContent .personal-search').allTextContents(), ['Real-1']);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), favoritesKey), null);
    assert.equal(await page.locator('#favorites, #favoriteInput').count(), 0);
    await complete(page, query);
    await assertContained(page);
}

async function checkBlockedStorage(browser, baseURL) {
    for (const mode of ['getter', 'read', 'write']) {
        const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
        await context.route('https://**', route => route.abort());
        await context.addInitScript(mode => {
            if (mode === 'getter') Object.defineProperty(window, 'localStorage', { get() { throw new Error('Blocked'); } });
            else Storage.prototype[mode === 'read' ? 'getItem' : 'setItem'] = function() { throw new Error('Blocked'); };
        }, mode);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        for (const pagePath of ['/', '/brake-pads']) {
            await page.goto(pagePath);
            const query = pagePath === '/' ? 'W1-ALT' : 'P-ALT';
            await complete(page, query);
            assert.equal(await page.locator('#recentContent .personal-search').innerText(), query);
            assert.match(await page.locator('#notifications').innerText(), /Локальное сохранение недоступно/);
            assert.equal(await page.locator('#error').isVisible(), false);
            await complete(page, 'ZZZ-999');
            await page.locator('#notFound').waitFor({ state: 'visible' });
            await page.locator('#notFound summary').click();
            assert.match(await page.locator('#notFoundContent').innerText(), /ZZZ-999.*Не найдено: 1/s);
            if (mode === 'write') {
                await complete(page, 'ZZZ-999');
                assert.match(await page.locator('#notFoundContent').innerText(), /ZZZ-999.*Не найдено: 2/s);
                await complete(page, 'SECOND-888');
                assert.deepEqual(await page.locator('#recentContent .personal-search').allTextContents(),
                    ['SECOND-888', 'ZZZ-999', query]);
            }
        }
        assert.deepEqual(errors, []);
        await context.close();
    }
}

async function checkNotFound(page, pagePath) {
    await page.goto(pagePath);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const endpoint = pagePath === '/' ? '/search' : '/search-brake-pads';
    const found = pagePath === '/' ?
        { main_part: 'FOUND', all_parts: ['FOUND'], section: 'Wipers' } :
        { main_part: 'FOUND', oe_analogue: '', not_original: '', section: 'Brake Pads' };
    let mode = 'empty';
    let prefixMode = 'empty';
    let calls = 0;
    const fulfill = (route, selected) => {
        if (selected === 'network') return route.abort();
        if (selected === 'invalid-json') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>error</html>' });
        if (selected === 'malformed') return route.fulfill({ json: { error: 'bad payload' } });
        if (typeof selected === 'number') return route.fulfill({ status: selected, json: { error: 'server error' } });
        return route.fulfill({ json: { results: selected === 'found' ? [found] : [] } });
    };
    await page.route('**' + endpoint, route => { calls += 1; return fulfill(route, mode); });
    if (pagePath === '/') await page.route('**/search-prefix', route => fulfill(route, prefixMode));
    try {
        await complete(page, 'Lost-1');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.items[0]?.count === 1, notFoundKey);
        let items = (await stored(page, notFoundKey)).items;
        assert.equal(items[0].key, 'LOST1');
        assert.equal(items[0].endpoint, endpoint);
        assert.ok(Number.isSafeInteger(items[0].lastAttempt));
        assert.equal(await page.locator('#notFound').isVisible(), true);
        await page.locator('#notFound summary').click();
        assert.match(await page.locator('#notFoundContent').innerText(), /Lost-1.*Не найдено: 1/s);
        const firstAttempt = items[0].lastAttempt;

        await complete(page, 'lost . 1');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.items[0]?.count === 2, notFoundKey);
        items = (await stored(page, notFoundKey)).items;
        assert.equal(items.length, 1);
        assert.equal(items[0].display, 'lost . 1');
        assert.ok(items[0].lastAttempt >= firstAttempt);
        await complete(page, 'Lost-2');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.items.length === 2, notFoundKey);
        assert.deepEqual((await stored(page, notFoundKey)).items.map(item => item.display), ['Lost-2', 'lost . 1']);
        assert.deepEqual(await page.locator('#notFoundContent .personal-search').allTextContents(), ['Lost-2', 'lost . 1']);
        await page.reload();
        await page.locator('#notFound').waitFor({ state: 'visible' });
        assert.deepEqual(await page.locator('#notFoundContent .personal-search').allTextContents(), ['Lost-2', 'lost . 1']);
        await page.locator('#notFound summary').click();

        const beforeErrors = await stored(page, notFoundKey);
        await submit(page, '');
        await page.locator('#error').waitFor({ state: 'visible' });
        for (const failed of [400, 503, 500, 'network', 'invalid-json', 'malformed']) {
            mode = failed;
            await submit(page, 'Lost-1');
            await page.locator('#error').waitFor({ state: 'visible' });
            assert.deepEqual(await stored(page, notFoundKey), beforeErrors);
        }
        mode = 'empty';
        if (pagePath === '/') {
            for (const failed of [503, 'network', 'invalid-json', 'malformed']) {
                prefixMode = failed;
                await complete(page, 'Lost-1');
                assert.deepEqual(await stored(page, notFoundKey), beforeErrors);
            }
            prefixMode = 'found';
            await complete(page, 'Lost-1');
            await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).items.length === 1, notFoundKey);
            assert.equal((await stored(page, notFoundKey)).items[0].key, 'LOST2');
            prefixMode = 'empty';
            await complete(page, 'Lost-1');
            await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).items.length === 2, notFoundKey);
        }
        mode = 'found';
        await complete(page, 'Lost-1');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).items.length === 1, notFoundKey);
        assert.equal((await stored(page, notFoundKey)).items[0].key, 'LOST2');
        mode = 'empty';
        const beforeReplay = calls;
        await page.locator('#notFoundContent .personal-search').click();
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).items[0].count === 2, notFoundKey);
        assert.equal(calls, beforeReplay + 1);
        assert.equal(await page.locator('#partNumber').inputValue(), 'Lost-2');
        assert.equal((await stored(page, notFoundKey)).items[0].count, 2);
        page.once('dialog', dialog => dialog.dismiss());
        await page.locator('#clearNotFound').click();
        assert.equal((await stored(page, notFoundKey)).items.length, 1);
        page.once('dialog', dialog => dialog.accept());
        await page.locator('#clearNotFound').click();
        assert.equal((await stored(page, notFoundKey)).items.length, 0);
        assert.equal(await page.locator('#notFound').isVisible(), false);
        assert.equal(await page.locator('#notFound').evaluate(node => node.getBoundingClientRect().height), 0);

        for (const corrupt of ['{broken', JSON.stringify({ version: 2, items: [] }), JSON.stringify({ version: 1, items: {} })]) {
            const recent = await stored(page, recentKey);
            await page.evaluate(([key, value]) => localStorage.setItem(key, value), [notFoundKey, corrupt]);
            await page.reload();
            assert.equal(await page.locator('#notFound').isVisible(), false);
            assert.deepEqual(await stored(page, recentKey), recent);
            await complete(page, 'Fresh-1');
            await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).items.length === 1, notFoundKey);
        }
        await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, items: [
            { key: 'VALID', display: 'Va-lid', endpoint: '/search', count: 2, lastAttempt: 10 },
            { key: 'WRONG', display: 'Other', endpoint: '/search', count: 1, lastAttempt: 10 },
            { key: 'BAD', display: 'Bad', endpoint: '/search', count: 0, lastAttempt: 10 },
            { key: 'VALID', display: 'Va-lid', endpoint: '/search', count: 3, lastAttempt: 5 },
            { key: 'FUTURE', display: 'Future', endpoint: '/search', count: 1, lastAttempt: Number.MAX_SAFE_INTEGER }
        ] })), notFoundKey);
        await page.reload();
        assert.equal(await page.locator('#notFound').isVisible(), pagePath === '/');
        if (pagePath === '/') {
            await page.locator('#notFound summary').click();
            assert.deepEqual(await page.locator('#notFoundContent .personal-search').allTextContents(), ['Va-lid']);
        }
        await complete(page, 'Fresh-2');
        assert.equal(await page.locator('#results').isVisible(), true);
    } finally {
        await page.unroute('**' + endpoint);
        if (pagePath === '/') await page.unroute('**/search-prefix');
    }
}

async function checkCategoryIsolation(page) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.route('**/search', route => route.fulfill({ json: { results: [] } }));
    await page.route('**/search-prefix', route => route.fulfill({ json: { results: [] } }));
    await page.route('**/search-brake-pads', route => route.fulfill({ json: { results: [] } }));
    try {
        await complete(page, 'Shared-1');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.items.length === 1, notFoundKey);
        await page.goto('/brake-pads');
        assert.equal(await page.locator('#notFound').isVisible(), false);
        await complete(page, 'shared . 1');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.items.length === 2, notFoundKey);
        assert.deepEqual(new Set((await stored(page, notFoundKey)).items.map(item => item.endpoint)),
            new Set(['/search', '/search-brake-pads']));
        await page.goto('/');
        await page.locator('#notFound').waitFor({ state: 'visible' });
        await page.locator('#notFound summary').click();
        assert.deepEqual(await page.locator('#notFoundContent .personal-search').allTextContents(), ['Shared-1']);
        await page.unroute('**/search');
        await page.route('**/search', route => route.fulfill({ json: { results: [
            { main_part: 'FOUND', all_parts: ['FOUND'], section: 'Wipers' }
        ] } }));
        await complete(page, 'Shared-1');
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).items.length === 1, notFoundKey);
        assert.equal((await stored(page, notFoundKey)).items[0].endpoint, '/search-brake-pads');
        assert.equal(await page.locator('#notFound').isVisible(), false);
        await page.goto('/brake-pads');
        await page.locator('#notFound').waitFor({ state: 'visible' });
    } finally {
        await page.unroute('**/search');
        await page.unroute('**/search-prefix');
        await page.unroute('**/search-brake-pads');
    }
}

async function checkCrossCategoryHint(page) {
    for (const [pagePath, query, linkName, expectedPath, expectedStock] of [
        ['/', 'P-ALT', 'Перейти к колодкам', '/brake-pads', 'PAD-200'],
        ['/brake-pads', 'W1ALT', 'Перейти к дворникам', '/', 'WIPER-100']
    ]) {
        await page.goto(pagePath);
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await complete(page, query);
        assert.match(await page.locator('.empty-result').innerText(), /не найден в базе/);
        const link = page.getByRole('link', { name: linkName, exact: true });
        await link.waitFor();
        assert.equal(new URL(await link.getAttribute('href'), 'http://localhost').pathname, expectedPath);
        await link.click();
        await page.waitForURL(url => new URL(url).pathname === expectedPath && new URL(url).searchParams.get('part_number') === query);
        await page.getByText(expectedStock, { exact: true }).waitFor();
        assert.equal(await page.locator('.cross-category-hint').count(), 0);
    }
}

async function checkCopyActions(browser, baseURL) {
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
    await context.route('https://**', route => route.abort());
    await context.addInitScript(() => {
        const clipboard = navigator.clipboard;
        const execCommand = document.execCommand.bind(document);
        window.copyMode = 'api';
        window.fallbackCalls = 0;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, get() {
            if (window.copyMode === 'missing') return undefined;
            if (window.copyMode === 'getter') throw new Error('Clipboard blocked');
            return { writeText: text => window.copyMode === 'api' ? clipboard.writeText(text) : Promise.reject(new Error('Clipboard denied')) };
        } });
        window.readClipboard = () => clipboard.readText();
        document.execCommand = command => {
            window.fallbackCalls += 1;
            window.fallbackText = document.activeElement.value;
            if (window.copyMode === 'failed') return false;
            if (window.copyMode === 'throw') throw new Error('Copy blocked');
            return execCommand(command);
        };
    });
    const page = await context.newPage();
    const errors = [];
    const searches = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('request', request => {
        if (request.method() === 'POST') searches.push(request.url());
    });
    async function copied(button, expected, key) {
        if (key) { await button.focus(); await button.press(key); }
        else await button.click();
        await page.waitForFunction(async expected => (await window.readClipboard()) === expected, expected);
        assert.equal(await page.locator('#copyStatus').innerText(), 'Скопировано.');
    }
    try {
        for (const pagePath of ['/', '/brake-pads']) {
            await page.goto(pagePath);
            await page.setViewportSize({ width: 320, height: 900 });
            const main = pagePath === '/' ? 'WIPER-100' : 'PAD-200';
            const alt = pagePath === '/' ? 'W1ALT' : 'P-ALT';
            await complete(page, pagePath === '/' ? 'W1-ALT' : alt);
            if (pagePath === '/') {
                assert.equal(await page.locator('.catalog-matches summary').count(), 0);
                assert.equal(await page.locator('.result-part').first().isVisible(), true);
                assert.equal(await page.locator('.match-disclaimer').evaluate(disclaimer =>
                    disclaimer.nextElementSibling?.classList.contains('catalog-matches')), true);
            } else {
                assert.equal(await page.locator('.catalog-matches summary').count(), 0);
                assert.equal(await page.locator('.detail-row').first().isVisible(), true);
                assert.equal(await page.locator('.stock-result').evaluate(stock =>
                    stock.nextElementSibling?.classList.contains('catalog-matches')), true);
                assert.deepEqual(await page.locator('.detail-label').allInnerTexts(), [
                    'Неоригинальные аналоги:',
                    'Оригинальный аналог:'
                ]);
            }
            const beforeSearches = searches.length;
            const beforeStorage = await page.evaluate(() => JSON.stringify(localStorage));
            const resultBefore = await page.locator('#resultsContent').innerHTML();
            await copied(page.getByRole('button', { name: `Копировать артикул: ${alt}`, exact: true }), alt);
            await copied(page.locator('.stock-result .copy-part'), main, 'Enter');
            assert.equal(await page.evaluate(() => window.fallbackCalls), 0);
            assert.equal(await page.locator('.copy-all').count(), 0);
            assert.equal(await page.locator('.stock-part').evaluate(node => node.tagName), 'SPAN');
            assert.equal(await page.locator('.stock-part').evaluate(node => getComputedStyle(node).userSelect), 'text');
            assert.notEqual(await page.locator('.stock-result .copy-part').evaluate(node => getComputedStyle(node).outlineStyle), 'none');
            const alternativeText = pagePath === '/' ? page.locator('.result-part .part-badge').first() : page.locator('.detail-row .detail-value').first();
            assert.equal(await alternativeText.evaluate(node => node.tagName), 'SPAN');
            assert.equal(await alternativeText.evaluate(node => getComputedStyle(node).userSelect), 'text');
            await alternativeText.click();
            assert.equal(await page.evaluate(() => window.readClipboard()), main);
            await page.waitForFunction(() => document.getElementById('copyStatus').textContent === '');

            for (const mode of ['denied', 'missing', 'getter']) {
                await page.evaluate(mode => { window.copyMode = mode; }, mode);
                await copied(page.getByRole('button', { name: `Копировать артикул: ${alt}`, exact: true }), alt, 'Enter');
                assert.equal(await page.evaluate(() => window.fallbackText), alt);
                assert.equal(await page.getByRole('button', { name: `Копировать артикул: ${alt}`, exact: true }).evaluate(node => node === document.activeElement), true);
                assert.equal(await page.locator('.clipboard-fallback').count(), 0);
            }
            for (const mode of ['failed', 'throw']) {
                await page.evaluate(mode => { window.copyMode = mode; }, mode);
                const copy = page.getByRole('button', { name: `Копировать артикул: ${alt}`, exact: true });
                await copy.click();
                await page.locator('#copyStatus.copy-error').waitFor();
                assert.match(await page.locator('#copyStatus').innerText(), /Выделите нужный артикул/);
                assert.equal(await page.locator('#results').isVisible(), true);
                assert.equal(await page.locator('#error').isVisible(), false);
                assert.equal(await page.locator('#resultsContent').innerHTML(), resultBefore);
                assert.equal(await page.locator('.clipboard-fallback').count(), 0);
                assert.equal(await copy.evaluate(node => node === document.activeElement), true);
            }
            assert.equal(searches.length, beforeSearches);
            assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), beforeStorage);
            await assertContained(page);

            await page.evaluate(() => { window.copyMode = 'api'; });
            const endpoint = pagePath === '/' ? '/search' : '/search-brake-pads';
            const duplicateGroup = pagePath === '/' ? {
                main_part: 'MAIN-1', all_parts: ['MAIN.1', 'ALT-2', 'alt .2', 'ALT-3', 'MAIN-1'], section: 'Wipers'
            } : { main_part: 'MAIN-1', oe_analogue: 'alt .2', not_original: 'ALT-2', section: 'Brake Pads' };
            await page.route('**' + endpoint, route => route.fulfill({ json: { results: [duplicateGroup, {
                main_part: 'OTHER-4', all_parts: ['OTHER-4'], oe_analogue: '', not_original: ''
            }] } }));
            await complete(page, 'ALT-2');
            await page.locator('.match-warning').waitFor();
            assert.match(await page.locator('.match-warning').innerText(), /несколько вариантов/);
            if (pagePath === '/brake-pads') {
                assert.equal(await page.locator('.catalog-summary').count(), 0);
                assert.equal(await page.locator('.detail-row').first().isVisible(), true);
                assert.deepEqual(await page.locator('.detail-label').allInnerTexts(), ['Неоригинальные аналоги:']);
            }
            assert.equal(await page.getByRole('button', { name: 'Копировать артикул: ALT-2', exact: true }).count(), 1);
            assert.equal(await page.locator('.result-group').nth(1).locator('.catalog-matches').count(), 0);
            await copied(page.getByRole('button', { name: 'Копировать артикул: MAIN-1', exact: true }).first(), 'MAIN-1');
            await copied(page.getByRole('button', { name: 'Копировать артикул: ALT-2', exact: true }), 'ALT-2');
            await page.unroute('**' + endpoint);
            if (pagePath === '/') {
                await complete(page, '2gm-extra');
                await copied(page.getByRole('button', { name: 'Копировать артикул: 2GM-ALT', exact: true }), '2GM-ALT');
            }
        }
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
}

async function checkReleaseScenario(browser, baseURL) {
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
    await context.route('https://**', route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        for (const [pagePath, query, main, copyPart, endpoint] of [
            ['/', 'w1 - alt', 'WIPER-100', 'W1ALT', '/search'],
            ['/brake-pads', 'p - alt', 'PAD-200', 'P-ALT', '/search-brake-pads']
        ]) {
            await page.goto(pagePath);
            await page.evaluate(() => localStorage.clear());
            await page.reload();
            await complete(page, query);
            assert.match(await page.locator('#resultsContent').innerText(), new RegExp(main));
            await page.getByRole('button', { name: `Копировать артикул: ${copyPart}`, exact: true }).first().click();
            assert.equal(await page.evaluate(() => navigator.clipboard.readText()), copyPart);
            assert.equal(await page.locator('.copy-all, #favorites, #favoriteInput').count(), 0);

            await page.locator('#recentContent .personal-search').first().click();
            await page.waitForFunction(([key, display]) => JSON.parse(localStorage.getItem(key)).items[0].display === display,
                [recentKey, query]);

            let missingMode = 'empty';
            const missing = 'MISSING-42';
            const found = pagePath === '/' ?
                { main_part: missing, all_parts: [missing], section: 'Wipers' } :
                { main_part: missing, oe_analogue: '', not_original: '', section: 'Brake Pads' };
            await page.route('**' + endpoint, route => {
                const body = route.request().postDataJSON();
                if (body.part_number === missing) {
                    if (missingMode === 'network') return route.abort();
                    return route.fulfill({ json: { results: missingMode === 'found' ? [found] : [] } });
                }
                return route.continue();
            });
            if (pagePath === '/') await page.route('**/search-prefix', route => route.fulfill({ json: { results: [] } }));
            try {
                await complete(page, missing);
                await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).items[0].count === 1, notFoundKey);
                await complete(page, missing);
                await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).items[0].count === 2, notFoundKey);
                missingMode = 'network';
                await submit(page, missing);
                await page.locator('#error').waitFor({ state: 'visible' });
                assert.equal((await stored(page, notFoundKey)).items[0].count, 2);
                missingMode = 'found';
                await complete(page, missing);
                await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).items.length === 0, notFoundKey);
                assert.match(await page.locator('#resultsContent').innerText(), new RegExp(missing));
                await page.reload();
                assert.equal(await page.locator('#recent').isVisible(), true);
                assert.equal(await page.locator('#notFound').isVisible(), false);

                // Clearing history leaves the not-found journal intact.
                const journal = await stored(page, notFoundKey);
                page.once('dialog', dialog => dialog.accept());
                await page.locator('#clearRecent').click();
                assert.equal((await stored(page, recentKey)).items.length, 0);
                assert.deepEqual(await stored(page, notFoundKey), journal);
                await assertContained(page);
            } finally {
                await page.unroute('**' + endpoint);
                if (pagePath === '/') await page.unroute('**/search-prefix');
            }
        }
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
}

async function checkServiceWorker(browser, baseURL) {
    const context = await browser.newContext({ baseURL, serviceWorkers: 'allow' });
    await context.route('https://**', route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto('/');
        await page.evaluate(async () => {
            const old = await caches.open('wiper-search-v1');
            await old.put('/', new Response('STALE-HTML'));
        });
        await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
        await page.waitForFunction(async () => {
            const names = await caches.keys();
            return names.includes('wiper-search-v2') && !names.includes('wiper-search-v1');
        });
        const shell = await page.evaluate(async () => {
            const cache = await caches.open('wiper-search-v2');
            for (const path of ['/', '/brake-pads', '/static/css/style.css', '/static/js/app.js']) {
                await cache.put(path, new Response('STALE-ASSET'));
            }
            return Promise.all(['/', '/brake-pads', '/static/css/style.css', '/static/js/app.js']
                .map(async path => ({ path, body: await (await fetch(path)).text() })));
        });
        for (const { path, body } of shell) {
            assert.ok(!body.includes('STALE-ASSET'), `${path} came from stale cache`);
            assert.ok(body.length > 100, `${path} did not load`);
        }
        await page.evaluate(() => navigator.serviceWorker.register('/static/sw.js'));
        await page.reload();
        await page.waitForFunction(async () => {
            const scopes = (await navigator.serviceWorker.getRegistrations()).map(registration => new URL(registration.scope).pathname);
            return scopes.includes('/') && !scopes.includes('/static/');
        });
        let calls = 0;
        await page.route('**/search', route => {
            calls += 1;
            return route.fulfill({ json: { results: [{ main_part: `LIVE-${calls}`, all_parts: [`LIVE-${calls}`] }] } });
        });
        await submit(page, 'LIVE-1');
        await page.getByRole('button', { name: 'Копировать артикул: LIVE-1' }).first().waitFor();
        await submit(page, 'LIVE-2');
        await page.getByRole('button', { name: 'Копировать артикул: LIVE-2' }).first().waitFor();
        assert.equal(calls, 2);
        const keys = await page.evaluate(async () => (await (await caches.open('wiper-search-v2')).keys()).map(request => request.url));
        assert.ok(keys.every(key => !key.endsWith('/search')));
        assert.deepEqual(errors, []);
    } finally { await context.close(); }
}

async function checkCrossTabLists(browser, baseURL) {
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
    const first = await context.newPage();
    const second = await context.newPage();
    try {
        await first.goto('/brake-pads');
        await first.evaluate(() => localStorage.clear());
        await first.reload();
        await second.goto('/brake-pads');
        for (const page of [first, second]) {
            await page.route('**/search-brake-pads', route => route.fulfill({ json: { results: [] } }));
        }
        await complete(first, 'Cross-1');
        await second.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.items.length === 1, recentKey);
        await complete(second, 'Cross-2');
        assert.deepEqual((await stored(second, recentKey)).items.map(item => item.display), ['Cross-2', 'Cross-1']);
        await first.waitForFunction(() => document.querySelectorAll('#recentContent .personal-search').length === 2);
        assert.deepEqual(await first.locator('#recentContent .personal-search').allTextContents(), ['Cross-2', 'Cross-1']);

        assert.deepEqual((await stored(second, notFoundKey)).items.map(item => item.display), ['Cross-2', 'Cross-1']);
        await first.waitForFunction(() => document.querySelectorAll('#notFoundContent .personal-search').length === 2);
        await complete(first, 'Cross-2');
        assert.equal((await stored(second, notFoundKey)).items.find(item => item.display === 'Cross-2').count, 2);
        await second.waitForFunction(() => document.querySelector('#notFoundContent .not-found-count')?.textContent === 'Не найдено: 2');
    } finally {
        await context.close();
    }
}

async function checkLatestSearchWins(browser, baseURL) {
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
    const page = await context.newPage();
    try {
        await page.goto('/brake-pads');
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        for (const [index, [oldResult, newResult]] of [
            ['found', 'found'], ['empty', 'found'], ['error', 'empty']
        ].entries()) {
            let releaseOld;
            let oldStarted;
            const oldStartedPromise = new Promise(resolve => { oldStarted = resolve; });
            const oldGate = new Promise(resolve => { releaseOld = resolve; });
            const oldQuery = `Old-${index}-${oldResult}`;
            const newQuery = `New-${index}-${newResult}`;
            await page.route('**/search-brake-pads', async route => {
                const query = route.request().postDataJSON().part_number;
                if (query === oldQuery) {
                    oldStarted();
                    await oldGate;
                    if (oldResult === 'error') return route.fulfill({ status: 500, json: { error: 'failed' } });
                    return route.fulfill({ json: { results: oldResult === 'empty' ? [] : [
                        { main_part: oldQuery, oe_analogue: '', not_original: '', section: 'Brake Pads' }
                    ] } });
                }
                return route.fulfill({ json: { results: newResult === 'empty' ? [] : [
                    { main_part: newQuery, oe_analogue: '', not_original: '', section: 'Brake Pads' }
                ] } });
            });
            await submit(page, oldQuery);
            await oldStartedPromise;
            await submit(page, newQuery);
            await page.locator('#results').waitFor({ state: 'visible' });
            await page.waitForFunction(([key, query]) => JSON.parse(localStorage.getItem(key))?.items[0]?.display === query,
                [recentKey, newQuery]);
            releaseOld();
            await page.waitForTimeout(100);
            assert.ok((await page.locator('#resultsContent').innerText()).includes(newQuery));
            assert.equal(await page.locator('#error').isVisible(), false);
            assert.ok(!(await stored(page, recentKey)).items.some(item => item.display === oldQuery));
            assert.ok(!(await stored(page, notFoundKey))?.items.some(item => item.display === oldQuery));
            await page.unroute('**/search-brake-pads');
        }
    } finally {
        await context.close();
    }
}

async function main() {
    const baseURL = await serverUrl();
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
        // External fonts/icons are cosmetic; make the check deterministic and offline.
        await context.route('https://**', route => route.abort());
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', err => pageErrors.push(err.message));

        for (const width of [1280, 320]) {
            await page.setViewportSize({ width, height: 900 });
            for (const pagePath of ['/', '/brake-pads']) {
                await checkShell(page, pagePath);
                const endpoint = pagePath === '/' ? '/search' : '/search-brake-pads';
                await submit(page, pagePath === '/' ? 'v w1-alt' : 'P-ALT', true);
                await page.locator('#results').waitFor({ state: 'visible' });
                assert.equal(await page.locator('.catalog-matches summary').count(), 0);
                if (pagePath === '/') {
                    assert.equal(await page.locator('.result-part').first().isVisible(), true);
                    assert.equal(await page.locator('.match-disclaimer').evaluate(disclaimer =>
                        disclaimer.nextElementSibling?.classList.contains('catalog-matches')), true);
                } else {
                    assert.equal(await page.locator('.detail-row').first().isVisible(), true);
                    assert.equal(await page.locator('.stock-result').evaluate(stock =>
                        stock.nextElementSibling?.classList.contains('catalog-matches')), true);
                    assert.deepEqual(await page.locator('.detail-label').allInnerTexts(), [
                        'Неоригинальные аналоги:',
                        'Оригинальный аналог:'
                    ]);
                }
                const text = await page.locator('#resultsContent').innerText();
                assert.match(text, pagePath === '/' ? /В заказ-наряд\s*WIPER-100/i : /В заказ-наряд\s*PAD-200/i);
                assert.match(text, pagePath === '/' ? /Передние дворники/ : /Передние тормозные колодки/);
                if (pagePath === '/brake-pads') {
                    assert.match(text, /Неоригинальные аналоги:\s*P-SECOND/);
                    assert.match(text, /Оригинальный аналог:\s*P-ALT/);
                }
                await assertContained(page);
                await submit(page, pagePath === '/' ? '2gm-extra' : 'P-SECOND');
                await page.locator('#results').waitFor({ state: 'visible' });
                assert.match(await page.locator('#resultsContent').innerText(), pagePath === '/' ? /Задние дворники/ : /PAD-200/);
                await submit(page, 'ZZZ-999');
                await page.locator('.empty-result').waitFor();
                assert.equal(await page.locator('.empty-result').innerText(), 'Артикул «ZZZ-999» не найден в базе.');
                await checkErrors(page, endpoint);
                await assertContained(page);
            }
        }

        await page.setViewportSize({ width: 320, height: 900 });
        await page.goto('/');
        const sections = ['Front Wipers', 'Back Wipers', 'Wipers', 'Brake Pads', 'Rear Brake Pads', 'constructor', '', 'Unknown category'];
        await page.route('**/search', route => route.fulfill({ json: {
            results: sections.map(section => ({
                main_part: 'VERY-LONG-' + '1'.repeat(80),
                all_parts: ['<img src=x onerror=alert(1)>', 'A'.repeat(100)],
                section
            }))
        } }));
        await submit(page, 'LONG');
        await page.locator('#results').waitFor({ state: 'visible' });
        assert.deepEqual(await page.locator('.section-badge').allTextContents(), [
            'Передние дворники', 'Задние дворники', 'Дворники', 'Тормозные колодки', 'Задние тормозные колодки',
            'Без секции', 'Без секции', 'Без секции'
        ]);
        assert.equal(await page.locator('#resultsContent img').count(), 0);
        await assertContained(page);
        await page.unroute('**/search');

        // Loading must be visible while waiting for the API, then replaced by results.
        let release;
        let started;
        const startedPromise = new Promise(resolve => { started = resolve; });
        const pending = new Promise(resolve => { release = resolve; });
        await page.route('**/search', async route => {
            started();
            await pending;
            await route.fulfill({ json: { results: [{ main_part: 'TEST', all_parts: ['TEST'], section: 'Wipers' }] } });
        });
        await submit(page, 'TEST');
        await startedPromise;
        await page.locator('#loading').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#loading').innerText(), 'Ищем аналоги…');
        assert.equal(await page.locator('#results').isVisible(), false);
        release();
        await page.locator('#results').waitFor({ state: 'visible' });
        await page.unroute('**/search');

        await page.locator('#partNumber').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#searchBtn').evaluate(node => node === document.activeElement), true);
        assert.notEqual(await page.locator('#searchBtn').evaluate(node => getComputedStyle(node).outlineStyle), 'none');

        if (process.env.UI_SCREENSHOT_DIR) {
            for (const width of [1280, 320]) {
                await page.setViewportSize({ width, height: 900 });
                await page.goto('/');
                await submit(page, 'W1ALT');
                await page.locator('#results').waitFor({ state: 'visible' });
                await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, `task02-${width}.png`), fullPage: true });
            }
        }
        assert.deepEqual(pageErrors, []);
        for (const pagePath of ['/', '/brake-pads']) await checkPersonalLists(page, pagePath);
        assert.deepEqual(pageErrors, []);
        for (const pagePath of ['/', '/brake-pads']) await checkNotFound(page, pagePath);
        await checkCategoryIsolation(page);
        await checkCrossCategoryHint(page);
        assert.deepEqual(pageErrors, []);
        await checkBlockedStorage(browser, baseURL);
        await checkCrossTabLists(browser, baseURL);
        await checkLatestSearchWins(browser, baseURL);
        await checkCopyActions(browser, baseURL);
        await checkReleaseScenario(browser, baseURL);
        await checkServiceWorker(browser, baseURL);
        await context.close();
        console.log('UI checks passed: both categories, 1280/320 px, search states/focus/escaped values; history/storage and removed favorites; not-found journal and error exclusions; per-article copy icons, selectable values, actual clipboard/API/fallback/errors, keyboard/focus; combined release journey; Service Worker shell refresh and live POST search.');
    } finally {
        await browser.close();
    }
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => { server.kill(); });
