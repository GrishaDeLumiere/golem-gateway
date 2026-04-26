// searchRenderer.js

/**
 * Генерирует компактный HTML/CSS блок поиска в строгом тёмном стиле.
 * Обернут в <ds-search-results>, чтобы скрывать его регулярными выражениями.
 * @param {Array} results - Массив результатов поиска
 * @param {boolean} showDetails - Разворачивать ли карточки с ссылками
 * @returns {string} - HTML строка
 * Легулярка для SillyTavern: <ds-search-results>([\s\S]*?)<\/ds-search-results>
 */
function renderSearchBlock(results, showDetails = true) {
    if (!results || results.length === 0) return '';

    // Аккуратная SVG иконка лупы
    const searchIconSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 6px; flex-shrink: 0;"><path d="M11.894845 6.647401C11.894845 3.725463 9.534486 1.356779 6.623219 1.35657C3.711786 1.35657 1.351635 3.725338 1.351635 6.647401C1.351843 9.569296 3.711911 11.938273 6.623219 11.938273C9.534361 11.938064 11.894637 9.569171 11.894845 6.647401ZM13.245462 6.647401C13.245254 10.317935 10.280401 13.293613 6.623219 13.293821C2.965871 13.293821 0.000204 10.31806 0 6.647401C0 2.976574 2.965746 0 6.623219 0C10.280526 0.000205 13.245462 2.9767 13.245462 6.647401Z" fill="currentColor"></path><path d="M16.000417 15.041079L15.044449 16.000433L11.530434 12.473588L12.486298 11.514234L16.000417 15.041079Z" fill="currentColor"></path></svg>`;

    // Компактная шапка
    const summaryHtml = `
 <summary style="display: flex; align-items: center; cursor: pointer; font-size: 13px; font-weight: 500; color: #a5b0c0; list-style: none; user-select: none;">
 ${searchIconSvg}
 <span>Прочитано ${results.length} веб-страниц</span>
 </summary>
 `;

    // Если выключены карточки ссылок, отдаем только верхнюю плашку
    if (!showDetails) {
        return `\n\n<ds-search-results>\n<div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 6px 10px; margin-top: 8px; display: inline-block;">\n${summaryHtml.replace('summary', 'div').replace('cursor: pointer;', '')}\n</div>\n</ds-search-results>\n\n`;
    }

    // Тело с мелкими, аккуратными карточками
    let detailsBody = '<div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">';

    results.forEach((r) => {
        // Жестко ограничиваем текст сниппета, чтобы он не растягивал чат
        let snippet = r.snippet ? (r.snippet.length > 130 ? r.snippet.substring(0, 130) + '...' : r.snippet) : '';
        const title = r.title || 'Источник';
        const siteName = r.site_name || new URL(r.url || 'https://example.com').hostname;

        detailsBody += `
 <a href="${r.url}" target="_blank" style="text-decoration: none; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: 6px 8px; display: block; color: inherit;">
 <div style="font-size: 11px; color: #8b949e; margin-bottom: 2px;">${siteName}</div>
 <div style="font-size: 13px; font-weight: 600; color: #58a6ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${title}</div>
 ${snippet ? `<div style="font-size: 12px; color: #8b949e; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${snippet}</div>` : ''}
 </a>
 `;
    });

    detailsBody += '</div>';

    // Вставляем грязный хак для скрытия стандартного треугольника details и собираем всё вместе
    return `\n\n<ds-search-results>\n<style>details > summary::-webkit-details-marker { display: none; }</style>\n<details style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 6px 10px; margin-top: 8px;">\n${summaryHtml}\n${detailsBody}\n</details>\n</ds-search-results>\n\n`;
}

module.exports = { renderSearchBlock };

