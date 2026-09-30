document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('partNumber');
    const searchForm = document.getElementById('searchForm');
    const searchEndpoint = searchForm.dataset.searchEndpoint;
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');
    const resultsContent = document.getElementById('resultsContent');
    const error = document.getElementById('error');
    const errorText = document.getElementById('errorText');
    const favoriteInput = document.getElementById('favoriteInput');
    const notifications = document.getElementById('notifications');
    const copyStatus = document.getElementById('copyStatus');
    let copyStatusTimer;
    const storageKeys = {
        recent: 'part-search:recent:v1',
        favorites: 'part-search:favorites:v1',
        notFound: 'part-search:not-found:v1'
    };
    const unsavedLists = new Set();

    // Same matching rule as normalize_token_for_match on the server.
    function normalizedKey(value) {
        return typeof value === 'string' ? value.replace(/[ .-]/g, '').toUpperCase() : '';
    }

    function storageWarning() {
        notifications.textContent = 'Локальное сохранение недоступно. Личные списки работают до перезагрузки страницы.';
    }

    function readList(name, fallback = []) {
        if (unsavedLists.has(name)) return fallback;
        let raw;
        try {
            raw = window.localStorage.getItem(storageKeys[name]);
        } catch (err) {
            storageWarning();
            return fallback;
        }
        try {
            if (raw === null) return [];
            const data = JSON.parse(raw);
            if (!data || data.version !== 1 || !Array.isArray(data.items)) throw new Error('Invalid storage format');
            const seen = new Set();
            const items = data.items.filter(item => {
                if (!item || typeof item.display !== 'string' || !item.display.trim() ||
                    !item.key || item.key !== normalizedKey(item.display) || seen.has(item.key)) return false;
                seen.add(item.key);
                return true;
            }).map(item => ({ key: item.key, display: item.display }));
            return name === 'recent' ? items.slice(0, 20) : items;
        } catch (err) {
            notifications.textContent = 'Не удалось восстановить локальный список. Поиск доступен.';
            return [];
        }
    }

    function writeList(name, items) {
        try {
            window.localStorage.setItem(storageKeys[name], JSON.stringify({ version: 1, items }));
            unsavedLists.delete(name);
        } catch (err) {
            unsavedLists.add(name);
            storageWarning();
        }
    }

    let recent = readList('recent');
    let favorites = readList('favorites');

    function readNotFound(fallback = []) {
        if (unsavedLists.has('notFound')) return fallback;
        let raw;
        try {
            raw = window.localStorage.getItem(storageKeys.notFound);
        } catch (err) {
            storageWarning();
            return fallback;
        }
        try {
            if (raw === null) return [];
            const data = JSON.parse(raw);
            if (!data || data.version !== 1 || !Array.isArray(data.items)) throw new Error('Invalid storage format');
            const seen = new Set();
            return data.items.filter(item => {
                if (!item || typeof item.display !== 'string' || !item.display.trim() ||
                    item.key !== normalizedKey(item.display) ||
                    !['/search', '/search-brake-pads'].includes(item.endpoint) ||
                    !Number.isSafeInteger(item.count) || item.count < 1 ||
                    !Number.isSafeInteger(item.lastAttempt) || item.lastAttempt < 0 ||
                    !Number.isFinite(new Date(item.lastAttempt).getTime())) return false;
                const identity = item.endpoint + ':' + item.key;
                if (seen.has(identity)) return false;
                seen.add(identity);
                return true;
            }).map(item => ({
                key: item.key, display: item.display, endpoint: item.endpoint,
                count: item.count, lastAttempt: item.lastAttempt
            })).sort((a, b) => b.lastAttempt - a.lastAttempt);
        } catch (err) {
            notifications.textContent = 'Не удалось восстановить локальный список. Поиск доступен.';
            return [];
        }
    }

    let notFound = readNotFound();

    function writeNotFound() {
        writeList('notFound', notFound);
    }

    function renderNotFound() {
        const content = document.getElementById('notFoundContent');
        const visible = notFound.filter(item => item.endpoint === searchEndpoint);
        content.replaceChildren();
        document.getElementById('notFound').hidden = visible.length === 0;
        visible.forEach(item => {
            const row = element('div', 'not-found-item');
            const button = element('button', 'personal-search', item.display);
            button.type = 'button';
            button.addEventListener('click', () => {
                searchInput.value = item.display;
                updateFavoriteButton(favoriteInput, searchInput.value, true);
                performSearch();
            });
            const date = element('time', 'not-found-date', new Date(item.lastAttempt).toLocaleString('ru-RU'));
            date.dateTime = new Date(item.lastAttempt).toISOString();
            row.append(button, element('span', 'not-found-count', `Не найдено: ${item.count}`), date);
            content.append(row);
        });
    }

    function updateNotFound(data, partNumber) {
        notFound = readNotFound(notFound);
        const key = normalizedKey(partNumber);
        const index = notFound.findIndex(item => item.endpoint === searchEndpoint && item.key === key);
        if (data.results.length === 0) {
            const count = index === -1 ? 1 : notFound[index].count + 1;
            if (index !== -1) notFound.splice(index, 1);
            notFound.unshift({ key, display: partNumber, endpoint: searchEndpoint, count, lastAttempt: Date.now() });
        } else if (index !== -1) {
            notFound.splice(index, 1);
        } else {
            return;
        }
        writeNotFound();
        renderNotFound();
    }

    function isFavorite(value) {
        return favorites.some(item => item.key === normalizedKey(value));
    }

    function updateFavoriteButton(button, value, input = false) {
        const selected = isFavorite(value);
        button.setAttribute('aria-pressed', String(selected));
        button.disabled = !normalizedKey(value.trim());
        button.textContent = input ? (selected ? 'Удалить из избранного' : 'Добавить в избранное') : (selected ? '★' : '☆');
        if (!input) button.setAttribute('aria-label', `${selected ? 'Удалить из избранного' : 'Добавить в избранное'}: ${value}`);
    }

    function toggleFavorite(value) {
        const display = value.trim();
        const key = normalizedKey(display);
        if (!key) return;
        favorites = readList('favorites', favorites);
        favorites = isFavorite(display) ? favorites.filter(item => item.key !== key) : [{ key, display }, ...favorites];
        writeList('favorites', favorites);
        renderPersonalLists();
    }

    function favoriteButton(value) {
        const button = element('button', 'favorite-toggle');
        button.type = 'button';
        button.dataset.part = value;
        updateFavoriteButton(button, value);
        button.addEventListener('click', () => toggleFavorite(value));
        return button;
    }

    function renderPersonalLists() {
        [['recent', recent], ['favorites', favorites]].forEach(([name, items]) => {
            const content = document.getElementById(name + 'Content');
            content.replaceChildren();
            document.getElementById(name).hidden = items.length === 0;
            items.forEach(item => {
                const row = element('div', 'personal-item');
                const button = element('button', 'personal-search', item.display);
                button.type = 'button';
                button.addEventListener('click', () => {
                    searchInput.value = item.display;
                    updateFavoriteButton(favoriteInput, searchInput.value, true);
                    performSearch();
                });
                row.append(button);
                if (name === 'favorites') row.append(favoriteButton(item.display));
                content.append(row);
            });
        });
        updateFavoriteButton(favoriteInput, searchInput.value, true);
        resultsContent.querySelectorAll('.favorite-toggle').forEach(button => updateFavoriteButton(button, button.dataset.part));
    }

    function recordSearch(partNumber) {
        const key = normalizedKey(partNumber);
        if (!key) return;
        recent = readList('recent', recent);
        recent = [{ key, display: partNumber }, ...recent.filter(item => item.key !== key)].slice(0, 20);
        writeList('recent', recent);
        renderPersonalLists();
    }

    const sectionNames = {
        'front wipers': 'Передние дворники',
        'back wipers': 'Задние дворники',
        'rear wipers': 'Задние дворники',
        'wipers': 'Дворники',
        'front brake pads': 'Передние тормозные колодки',
        'rear brake pads': 'Задние тормозные колодки',
        'back brake pads': 'Задние тормозные колодки',
        'brake pads': 'Тормозные колодки'
    };

    function sectionLabel(section) {
        const key = String(section || '').trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(sectionNames, key) ? sectionNames[key] : 'Без секции';
    }

    function hideAllStates() {
        loading.classList.add('hidden');
        results.classList.add('hidden');
        error.classList.add('hidden');
    }

    function showLoading() {
        hideAllStates();
        loading.classList.remove('hidden');
    }

    function showError(message) {
        hideAllStates();
        errorText.textContent = message;
        error.classList.remove('hidden');
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function showCopyStatus(message, failed = false) {
        window.clearTimeout(copyStatusTimer);
        copyStatus.textContent = message;
        copyStatus.classList.toggle('copy-error', failed);
        if (!failed) copyStatusTimer = window.setTimeout(() => { copyStatus.textContent = ''; }, 2500);
    }

    function fallbackCopy(text) {
        const active = document.activeElement;
        const selection = window.getSelection();
        const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
        const textarea = element('textarea', 'clipboard-fallback');
        textarea.value = text;
        textarea.readOnly = true;
        textarea.setAttribute('aria-label', 'Текст для копирования');
        document.body.append(textarea);
        try {
            textarea.focus({ preventScroll: true });
            textarea.select();
            if (!document.execCommand('copy')) throw new Error('Copy failed');
        } finally {
            textarea.remove();
            if (active && active.isConnected) active.focus({ preventScroll: true });
            if (selection) {
                selection.removeAllRanges();
                ranges.forEach(range => selection.addRange(range));
            }
        }
    }

    async function copyText(text) {
        try {
            try {
                if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('Clipboard unavailable');
                await navigator.clipboard.writeText(text);
            } catch (err) {
                fallbackCopy(text);
            }
            showCopyStatus('Скопировано.');
        } catch (err) {
            showCopyStatus('Не удалось скопировать. Выделите нужный артикул и скопируйте его вручную.', true);
        }
    }

    function copyButton(value, className = 'copy-part', label = value) {
        const button = element('button', className, label);
        button.type = 'button';
        button.setAttribute('aria-label', `Копировать артикул: ${value}`);
        button.title = 'Копировать артикул';
        button.addEventListener('click', () => copyText(value));
        return button;
    }

    function groupCopyText(group) {
        const values = searchEndpoint === '/search-brake-pads' ? [group.oe_analogue, group.not_original] : group.all_parts;
        const seen = new Set([normalizedKey(group.main_part)]);
        const alternatives = values.filter(value => {
            const key = normalizedKey(value);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        return `Основной артикул: ${group.main_part}` + (alternatives.length ? `\nАналоги:\n${alternatives.join('\n')}` : '');
    }

    function showResults(data, partNumber) {
        hideAllStates();
        window.clearTimeout(copyStatusTimer);
        copyStatus.textContent = '';
        resultsContent.replaceChildren();

        if (!data.results || data.results.length === 0) {
            const group = element('div', 'result-group');
            group.append(element('p', 'empty-result', `Артикул «${partNumber}» не найден в базе.`));
            resultsContent.append(group);
        } else {
            data.results.forEach(group => {
                const card = element('div', 'result-group');
                const heading = element('div', 'result-main');
                const mainPart = element('span', 'main-part', 'Основной артикул: ');
                mainPart.append(copyButton(group.main_part, 'copy-part main-part-number'));
                heading.append(mainPart);
                heading.append(favoriteButton(group.main_part));
                heading.append(element('span', 'section-badge', sectionLabel(group.section)));
                card.append(heading);
                const copyAll = element('button', 'text-action copy-all', 'Копировать все');
                copyAll.type = 'button';
                copyAll.setAttribute('aria-label', `Копировать все: ${group.main_part}`);
                copyAll.addEventListener('click', () => copyText(groupCopyText(group)));
                card.append(copyAll);

                if (searchEndpoint === '/search-brake-pads') {
                    const details = element('div', 'result-details');
                    [
                        ['Оригинальный аналог', group.oe_analogue],
                        ['Неоригинальные аналоги', group.not_original]
                    ].forEach(([label, value]) => {
                        if (!value) return;
                        const row = element('div', 'detail-row');
                        row.append(element('span', 'detail-label', `${label}:`));
                        row.append(copyButton(value, 'copy-part detail-value'));
                        row.append(favoriteButton(value));
                        details.append(row);
                    });
                    card.append(details);
                } else {
                    const parts = element('div', 'result-parts');
                    group.all_parts.forEach(part => {
                        const highlighted = part.toUpperCase() === partNumber.toUpperCase();
                        const item = element('div', 'result-part');
                        item.append(copyButton(part, highlighted ? 'copy-part part-badge highlighted' : 'copy-part part-badge'));
                        item.append(favoriteButton(part));
                        parts.append(item);
                    });
                    card.append(parts);
                }
                resultsContent.append(card);
            });
        }
        results.classList.remove('hidden');
    }

    function responseError(status) {
        if (status === 400) return 'Проверьте артикул и повторите поиск.';
        if (status === 503) return 'База поиска ещё загружается. Повторите попытку через несколько секунд.';
        return 'Не удалось выполнить поиск. Повторите попытку позже.';
    }

    let latestSearchId = 0;

    async function performSearch() {
        const searchId = ++latestSearchId;
        const partNumber = searchInput.value.trim();
        if (!partNumber) {
            showError('Введите артикул для поиска.');
            return;
        }

        showLoading();
        try {
            const response = await fetch(searchEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ part_number: partNumber })
            });
            if (searchId !== latestSearchId) return;
            if (!response.ok) {
                showError(responseError(response.status));
                return;
            }
            const data = await response.json();
            if (searchId !== latestSearchId) return;
            validateResults(data);

            // Сохраняем текущий запасной поиск по префиксу только для дворников.
            if (searchEndpoint === '/search' && (!data.results || data.results.length === 0) && partNumber.length >= 3) {
                try {
                    const prefixResponse = await fetch('/search-prefix', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ part_prefix: partNumber })
                    });
                    if (searchId !== latestSearchId) return;
                    if (!prefixResponse.ok) throw new Error('Ошибка поиска по префиксу');
                    const prefixData = await prefixResponse.json();
                    if (searchId !== latestSearchId) return;
                    validateResults(prefixData);
                    showResults(prefixData, partNumber);
                    recordSearch(partNumber);
                    updateNotFound(prefixData, partNumber);
                    return;
                } catch (prefixError) {
                    if (searchId !== latestSearchId) return;
                    console.error('Ошибка поиска по префиксу:', prefixError);
                    showResults(data, partNumber);
                    recordSearch(partNumber);
                    return;
                }
            }
            showResults(data, partNumber);
            recordSearch(partNumber);
            updateNotFound(data, partNumber);
        } catch (err) {
            if (searchId !== latestSearchId) return;
            console.error('Ошибка поиска:', err);
            showError('Не удалось получить результаты. Проверьте подключение к сети и повторите поиск.');
        }
    }

    function validateResults(data) {
        if (!data || !Array.isArray(data.results) || data.results.some(group =>
            !group || typeof group.main_part !== 'string' ||
            (searchEndpoint === '/search' && (!Array.isArray(group.all_parts) || group.all_parts.some(part => typeof part !== 'string'))) ||
            (searchEndpoint === '/search-brake-pads' && [group.oe_analogue, group.not_original].some(value => value != null && typeof value !== 'string'))
        )) throw new Error('Invalid search response');
    }

    searchInput.addEventListener('input', () => updateFavoriteButton(favoriteInput, searchInput.value, true));
    favoriteInput.addEventListener('click', () => toggleFavorite(searchInput.value));
    document.getElementById('clearRecent').addEventListener('click', () => {
        if (!window.confirm('Очистить всю историю поиска?')) return;
        recent = [];
        writeList('recent', recent);
        renderPersonalLists();
    });
    document.getElementById('clearNotFound').addEventListener('click', () => {
        if (!window.confirm('Очистить весь журнал ненайденных артикулов?')) return;
        notFound = [];
        writeNotFound();
        renderNotFound();
    });
    window.addEventListener('storage', event => {
        if (event.storageArea !== window.localStorage) return;
        if (event.key === null || event.key === storageKeys.recent) recent = readList('recent', recent);
        if (event.key === null || event.key === storageKeys.favorites) favorites = readList('favorites', favorites);
        if (event.key === null || event.key === storageKeys.notFound) notFound = readNotFound(notFound);
        if (event.key === null || event.key === storageKeys.recent || event.key === storageKeys.favorites) renderPersonalLists();
        if (event.key === null || event.key === storageKeys.notFound) renderNotFound();
    });
    renderPersonalLists();
    renderNotFound();

    // Отправка формы работает и по Enter, и по кнопке, включая экранную клавиатуру.
    searchForm.addEventListener('submit', function(event) {
        event.preventDefault();
        performSearch();
    });

    if (window.innerWidth > 768) searchInput.focus();

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', async () => {
            try {
                await navigator.serviceWorker.register('/static/sw.js', { scope: '/' });
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations
                    .filter(registration => new URL(registration.scope).pathname === '/static/')
                    .map(registration => registration.unregister()));
            } catch (registrationError) {
                console.error('Не удалось зарегистрировать Service Worker:', registrationError);
            }
        });
    }
});
