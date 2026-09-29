document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('partNumber');
    const searchForm = document.getElementById('searchForm');
    const searchEndpoint = searchForm.dataset.searchEndpoint;
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');
    const resultsContent = document.getElementById('resultsContent');
    const error = document.getElementById('error');
    const errorText = document.getElementById('errorText');

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

    function showResults(data, partNumber) {
        hideAllStates();
        resultsContent.replaceChildren();

        if (!data.results || data.results.length === 0) {
            const group = element('div', 'result-group');
            group.append(element('p', 'empty-result', `Артикул «${partNumber}» не найден в базе.`));
            resultsContent.append(group);
        } else {
            data.results.forEach(group => {
                const card = element('div', 'result-group');
                const heading = element('div', 'result-main');
                heading.append(element('span', 'main-part', `Основной артикул: ${group.main_part}`));
                heading.append(element('span', 'section-badge', sectionLabel(group.section)));
                card.append(heading);

                if (searchEndpoint === '/search-brake-pads') {
                    const details = element('div', 'result-details');
                    [
                        ['Оригинальный аналог', group.oe_analogue],
                        ['Неоригинальные аналоги', group.not_original]
                    ].forEach(([label, value]) => {
                        if (!value) return;
                        const row = element('div', 'detail-row');
                        row.append(element('span', 'detail-label', `${label}:`));
                        row.append(element('span', 'detail-value', value));
                        details.append(row);
                    });
                    card.append(details);
                } else {
                    const parts = element('div', 'result-parts');
                    group.all_parts.forEach(part => {
                        const highlighted = part.toUpperCase() === partNumber.toUpperCase();
                        parts.append(element('span', highlighted ? 'part-badge highlighted' : 'part-badge', part));
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

    async function performSearch() {
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
            if (!response.ok) {
                showError(responseError(response.status));
                return;
            }
            const data = await response.json();

            // Сохраняем текущий запасной поиск по префиксу только для дворников.
            if (searchEndpoint === '/search' && (!data.results || data.results.length === 0) && partNumber.length >= 3) {
                try {
                    const prefixResponse = await fetch('/search-prefix', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ part_prefix: partNumber })
                    });
                    if (!prefixResponse.ok) throw new Error('Ошибка поиска по префиксу');
                    showResults(await prefixResponse.json(), partNumber);
                    return;
                } catch (prefixError) {
                    console.error('Ошибка поиска по префиксу:', prefixError);
                }
            }
            showResults(data, partNumber);
        } catch (err) {
            console.error('Ошибка поиска:', err);
            showError('Не удалось получить результаты. Проверьте подключение к сети и повторите поиск.');
        }
    }

    // Отправка формы работает и по Enter, и по кнопке, включая экранную клавиатуру.
    searchForm.addEventListener('submit', function(event) {
        event.preventDefault();
        performSearch();
    });

    if (window.innerWidth > 768) searchInput.focus();

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/static/sw.js').catch(registrationError => {
                console.error('Не удалось зарегистрировать Service Worker:', registrationError);
            });
        });
    }
});
