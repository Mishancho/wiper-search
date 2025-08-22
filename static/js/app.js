document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('partNumber');
    const searchBtn = document.getElementById('searchBtn');
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');
    const resultsContent = document.getElementById('resultsContent');
    const error = document.getElementById('error');
    const errorText = document.getElementById('errorText');

    // Функция для скрытия всех состояний
    function hideAllStates() {
        loading.classList.add('hidden');
        results.classList.add('hidden');
        error.classList.add('hidden');
    }

    // Функция для показа загрузки
    function showLoading() {
        hideAllStates();
        loading.classList.remove('hidden');
    }

    // Функция для показа ошибки
    function showError(message) {
        hideAllStates();
        errorText.textContent = message;
        error.classList.remove('hidden');
    }

    // Функция для показа результатов
    function showResults(data) {
        hideAllStates();
        
        if (!data.results || data.results.length === 0) {
            resultsContent.innerHTML = `
                <div class="result-group">
                    <div class="result-main">
                        <i class="fas fa-info-circle"></i>
                        ${data.message}
                    </div>
                </div>
            `;
        } else {
            let html = '';
            
            data.results.forEach((group, index) => {
                html += `
                    <div class="result-group">
                        <div class="result-main">
                            <i class="fas fa-link"></i>
                            Main Part: ${group.main_part}
                            <span class="section-badge">${group.section || 'Unknown'}</span>
                        </div>
                        <div class="result-parts">
                `;
                
                group.all_parts.forEach(part => {
                    const isHighlighted = part.toUpperCase() === searchInput.value.toUpperCase();
                    const badgeClass = isHighlighted ? 'part-badge highlighted' : 'part-badge';
                    html += `<span class="${badgeClass}">${part}</span>`;
                });
                
                html += `
                        </div>
                    </div>
                `;
            });
            
            resultsContent.innerHTML = html;
        }
        
        results.classList.remove('hidden');
    }

    // Функция для выполнения поиска
    async function performSearch() {
        const partNumber = searchInput.value.trim();
        
        if (!partNumber) {
            showError('Please enter a part number to search');
            return;
        }

        showLoading();

        try {
            const response = await fetch('/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ part_number: partNumber })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Произошла ошибка при поиске');
            }

            showResults(data);

        } catch (err) {
            console.error('Ошибка поиска:', err);
            showError(err.message || 'An error occurred during search. Please try again.');
        }
    }

    // Обработчик клика по кнопке поиска
    searchBtn.addEventListener('click', performSearch);

    // Обработчик нажатия Enter в поле ввода
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // Фокус на поле ввода при загрузке страницы (только на десктопе)
    if (window.innerWidth > 768) {
        searchInput.focus();
    }

    // Добавляем анимацию при вводе
    searchInput.addEventListener('input', function() {
        if (this.value.trim()) {
            searchBtn.style.transform = 'scale(1.05)';
        } else {
            searchBtn.style.transform = 'scale(1)';
        }
    });

    // Плавная анимация для кнопки
    searchBtn.addEventListener('mouseenter', function() {
        if (searchInput.value.trim()) {
            this.style.transform = 'scale(1.05) translateY(-2px)';
        }
    });

    searchBtn.addEventListener('mouseleave', function() {
        if (searchInput.value.trim()) {
            this.style.transform = 'scale(1.05)';
        } else {
            this.style.transform = 'scale(1)';
        }
    });

    // Add input hints
    const examples = ['6R1998002', '5E1', '1S1', '5JB'];
    let currentExampleIndex = 0;

    searchInput.addEventListener('focus', function() {
        if (!this.value) {
            this.placeholder = `Enter part number (e.g., ${examples[currentExampleIndex]})`;
        }
    });

    // Меняем примеры каждые 3 секунды
    setInterval(() => {
        if (document.activeElement !== searchInput || searchInput.value) {
            currentExampleIndex = (currentExampleIndex + 1) % examples.length;
            if (!searchInput.value) {
                searchInput.placeholder = `Enter part number (e.g., ${examples[currentExampleIndex]})`;
            }
        }
    }, 3000);

    // Mobile-specific improvements
    function initMobileFeatures() {
        // Prevent zoom on input focus (iOS)
        const inputs = document.querySelectorAll('input[type="text"]');
        inputs.forEach(input => {
            input.addEventListener('focus', function() {
                if (window.innerWidth <= 768) {
                    setTimeout(() => {
                        this.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 300);
                }
            });
        });

        // Add touch feedback
        const buttons = document.querySelectorAll('button');
        buttons.forEach(button => {
            button.addEventListener('touchstart', function() {
                this.style.transform = 'scale(0.95)';
            });
            
            button.addEventListener('touchend', function() {
                this.style.transform = '';
            });
        });

        // Improve scrolling on mobile
        document.body.style.webkitOverflowScrolling = 'touch';
    }

    // Initialize mobile features
    initMobileFeatures();

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/static/sw.js')
                .then(registration => {
                    console.log('SW registered: ', registration);
                })
                .catch(registrationError => {
                    console.log('SW registration failed: ', registrationError);
                });
        });
    }
});
