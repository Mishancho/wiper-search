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
    for (const id of ['favorites', 'recent', 'notFound']) {
        assert.equal(await page.locator('#' + id).isVisible(), false);
        assert.equal(await page.locator('#' + id).evaluate(node => node.getBoundingClientRect().height), 0);
    }
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
    await page.locator('#partNumber').fill(query);
    await page.locator('#favoriteInput').click();
    assert.deepEqual((await stored(page, favoritesKey)).items, [{ key: query.replace('-', ''), display: query }]);
    await complete(page, query);
    const resultPart = pagePath === '/' ? 'WIPER-100' : 'PAD-200';
    await page.locator('.result-main').getByRole('button', { name: 'Добавить в избранное: ' + resultPart, exact: true }).click();
    assert.equal((await stored(page, favoritesKey)).items.length, 2);
    const analogue = pagePath === '/' ? 'W1-ALT' : 'P-SECOND';
    if (pagePath !== '/') {
        await page.locator('.detail-row').getByRole('button', { name: 'Добавить в избранное: ' + analogue, exact: true }).click();
        assert.equal((await stored(page, favoritesKey)).items.length, 3);
    }
    await page.reload();
    await page.locator('#favorites').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#recentContent .personal-search').innerText(), query);
    await page.locator('#favoritesContent').getByRole('button', { name: resultPart, exact: true }).click();
    await page.locator('#results').waitFor({ state: 'visible' });
    assert.match(await page.locator('#resultsContent').innerText(), new RegExp(resultPart));
    assert.equal((await stored(page, recentKey)).items[0].display, resultPart);
    await page.locator('#favoritesContent').getByRole('button', { name: 'Удалить из избранного: ' + resultPart, exact: true }).click();
    assert.ok(!(await stored(page, favoritesKey)).items.some(item => item.display === resultPart));
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
    const preservedFavorites = await stored(page, favoritesKey);
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#clearRecent').click();
    assert.equal((await stored(page, recentKey)).items.length, 20);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#clearRecent').click();
    assert.equal((await stored(page, recentKey)).items.length, 0);
    assert.equal(await page.locator('#recent').isVisible(), false);
    assert.deepEqual(await stored(page, favoritesKey), preservedFavorites);
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
        assert.deepEqual(await stored(page, favoritesKey), preservedFavorites);
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
    assert.equal(await page.locator('#favorites').isVisible(), false);
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
            await page.locator('#favoriteInput').click();
            assert.equal(await page.locator('#favoritesContent .personal-search').innerText(), query);
            assert.match(await page.locator('#notifications').innerText(), /Локальное сохранение недоступно/);
            await page.locator('#favoritesContent .personal-search').click();
            await page.locator('#results').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#error').isVisible(), false);
        }
        assert.deepEqual(errors, []);
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
                const text = await page.locator('#resultsContent').innerText();
                assert.match(text, pagePath === '/' ? /Основной артикул: WIPER-100/ : /Основной артикул: PAD-200/);
                assert.match(text, pagePath === '/' ? /Передние дворники/ : /Передние тормозные колодки/);
                if (pagePath === '/brake-pads') {
                    assert.match(text, /Оригинальный аналог:\s*P-ALT/);
                    assert.match(text, /Неоригинальные аналоги:\s*P-SECOND/);
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
        await checkBlockedStorage(browser, baseURL);
        await context.close();
        console.log('UI checks passed: both categories, 1280/320 px, search states/focus/escaped values; history limit/dedup/order/replay/confirmed clear; favorites toggle/replay/reload; corrupt/versioned data; blocked storage reads/writes/getter.');
    } finally {
        await browser.close();
    }
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => { server.kill(); });
