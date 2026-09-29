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
    await page.unroute('**' + endpoint);
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
        await context.close();
        console.log('UI checks passed: both categories, 1280/320 px, Enter/button, sections, empty/loading/errors, keyboard focus, escaped values.');
    } finally {
        await browser.close();
    }
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => { server.kill(); });
