// ==UserScript==
// @name         PaintFloid's Spiderlines Tampermonkey-Tradingview
// @namespace    https://github.com/420vet/spiderlines-tampermonkey-tradingview
// @version      1.0.0
// @author       PaintFloid
// @homepageURL  https://github.com/420vet/spiderlines-tampermonkey-tradingview
// @supportURL   https://github.com/420vet/spiderlines-tampermonkey-tradingview/issues
// @updateURL    https://raw.githubusercontent.com/420vet/spiderlines-tampermonkey-tradingview/main/spiderlines.user.js
// @downloadURL  https://raw.githubusercontent.com/420vet/spiderlines-tampermonkey-tradingview/main/spiderlines.user.js
// @description  Draws native TradingView rays from an anchor point to every confirmed pivot high/low after it. Rays are regular drawings: editable, saved in the layout and visible on every timeframe.
// @match        https://www.tradingview.com/*
// @match        https://tradingview.com/*
// @match        https://*.tradingview.com/*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const SETTINGS_KEY = 'spiderlines:settings';
    const DRAWINGS_KEY_PREFIX = 'spiderlines:';
    const PRICE_MATCH_EPSILON = 1e-9;
    const LINE_STYLES = { solid: 0, dotted: 1, dashed: 2 };
    const ALL_INTERVALS_VISIBLE = {
        ticks: true,
        seconds: true, secondsFrom: 1, secondsTo: 59,
        minutes: true, minutesFrom: 1, minutesTo: 59,
        hours: true, hoursFrom: 1, hoursTo: 24,
        days: true, daysFrom: 1, daysTo: 366,
        weeks: true, weeksFrom: 1, weeksTo: 52,
        months: true, monthsFrom: 1, monthsTo: 12,
        ranges: true,
    };

    const DEFAULT_SETTINGS = {
        anchorTime: null,
        anchorPrice: null,
        snapToWick: true,
        showHighs: true,
        highColor: '#f23645',
        highLeft: 2,
        highRight: 2,
        showLows: true,
        lowColor: '#089981',
        lowLeft: 2,
        lowRight: 2,
        maxLines: 30,
        lineWidth: 1,
        lineStyle: 'solid',
        collapsed: false,
        panelLeft: null,
        panelTop: 80,
    };

    const safeRead = (key, fallback) => {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    };

    const safeWrite = (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            return;
        }
    };

    const settings = { ...DEFAULT_SETTINGS, ...safeRead(SETTINGS_KEY, {}) };
    const saveSettings = () => safeWrite(SETTINGS_KEY, settings);

    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const getApi = () => pageWindow.TradingViewApi;

    const getChart = () => {
        const api = getApi();
        if (!api || typeof api.activeChart !== 'function') return null;
        try {
            return api.activeChart();
        } catch {
            return null;
        }
    };

    const getSymbol = chart => {
        try {
            return chart.symbol() || 'unknown';
        } catch {
            return 'unknown';
        }
    };

    const drawingsKey = chart => DRAWINGS_KEY_PREFIX + getSymbol(chart);

    const readBarsFromExport = async chart => {
        if (typeof chart.exportData !== 'function') return null;
        const exported = await chart.exportData({ includeTime: true, includeSeries: true, includedStudies: [] });
        if (!exported || !Array.isArray(exported.schema) || !exported.data) return null;
        const columnOf = name => exported.schema.findIndex(field =>
            field.type === 'value' && String(field.plotTitle || '').toLowerCase() === name);
        const timeColumn = exported.schema.findIndex(field => field.type === 'time');
        const highColumn = columnOf('high');
        const lowColumn = columnOf('low');
        if (timeColumn < 0 || highColumn < 0 || lowColumn < 0) return null;
        return Array.from(exported.data, row => ({
            time: row[timeColumn],
            high: row[highColumn],
            low: row[lowColumn],
        })).filter(bar => Number.isFinite(bar.time) && Number.isFinite(bar.high) && Number.isFinite(bar.low));
    };

    const readBarsFromModel = () => {
        const api = getApi();
        const widget = api && api._activeChartWidgetWV && api._activeChartWidgetWV.value();
        const model = widget && widget._chartWidget && widget._chartWidget.model();
        const bars = model && model.mainSeries().bars();
        if (!bars || typeof bars.each !== 'function') return null;
        const result = [];
        bars.each((index, value) => {
            result.push({ time: value[0], high: value[2], low: value[3] });
            return false;
        });
        return result;
    };

    const readBars = async chart => {
        let bars = null;
        try {
            bars = await readBarsFromExport(chart);
        } catch {
            bars = null;
        }
        if (!bars || bars.length === 0) {
            try {
                bars = readBarsFromModel();
            } catch {
                bars = null;
            }
        }
        return bars && bars.length ? bars.sort((a, b) => a.time - b.time) : null;
    };

    const findBarIndexAtOrBefore = (bars, time) => {
        let low = 0;
        let high = bars.length - 1;
        let found = -1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (bars[middle].time <= time) {
                found = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return found;
    };

    const isPivot = (bars, index, left, right, key, isHigh) => {
        const value = bars[index][key];
        const beats = (candidate, strict) => isHigh
            ? (strict ? value > candidate : value >= candidate)
            : (strict ? value < candidate : value <= candidate);
        for (let offset = 1; offset <= left; offset++) {
            if (!beats(bars[index - offset][key], true)) return false;
        }
        for (let offset = 1; offset <= right; offset++) {
            if (!beats(bars[index + offset][key], false)) return false;
        }
        return true;
    };

    const findPivots = (bars, anchorIndex, left, right, isHigh) => {
        const key = isHigh ? 'high' : 'low';
        const lastClosedIndex = bars.length - 2;
        const pivots = [];
        const firstIndex = Math.max(anchorIndex + 1, left);
        for (let index = firstIndex; index + right <= lastClosedIndex; index++) {
            if (isPivot(bars, index, left, right, key, isHigh)) {
                pivots.push({ index, time: bars[index].time, price: bars[index][key], isHigh });
            }
        }
        return pivots;
    };

    const toLocalInputValue = seconds => {
        if (!Number.isFinite(seconds)) return '';
        const date = new Date(seconds * 1000);
        const pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };

    const fromLocalInputValue = value => {
        const milliseconds = new Date(value).getTime();
        return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
    };

    const samePoint = (a, b) => Math.abs(a.time - b.time) < 1 &&
        Math.abs(a.price - b.price) <= Math.max(PRICE_MATCH_EPSILON, Math.abs(b.price) * 1e-9);

    const shapePoints = (chart, id) => {
        try {
            const shape = chart.getShapeById(id);
            return shape && typeof shape.getPoints === 'function' ? shape.getPoints() : null;
        } catch {
            return null;
        }
    };

    const removeShape = (chart, id) => {
        try {
            chart.removeEntity(id);
            return true;
        } catch {
            return false;
        }
    };

    const clearSpiderlines = chart => {
        const key = drawingsKey(chart);
        const records = safeRead(key, []);
        if (!records.length) return 0;
        let removed = 0;
        const existingIds = new Set();
        try {
            chart.getAllShapes().forEach(shape => existingIds.add(shape.id));
        } catch {
            records.forEach(record => existingIds.add(record.id));
        }
        records.forEach(record => {
            if (existingIds.has(record.id) && removeShape(chart, record.id)) {
                existingIds.delete(record.id);
                removed++;
            }
        });
        try {
            chart.getAllShapes()
                .filter(shape => shape.name === 'ray' && existingIds.has(shape.id))
                .forEach(shape => {
                    const points = shapePoints(chart, shape.id);
                    if (!points || points.length < 2) return;
                    const matches = records.some(record =>
                        samePoint(points[0], record.from) && samePoint(points[1], record.to));
                    if (matches && removeShape(chart, shape.id)) removed++;
                });
        } catch {
            removed += 0;
        }
        safeWrite(key, []);
        return removed;
    };

    const createRay = async (chart, from, to, color) => {
        const id = await Promise.resolve(chart.createMultipointShape([from, to], {
            shape: 'ray',
            lock: false,
            disableSelection: false,
            disableSave: false,
            disableUndo: false,
            overrides: {
                linecolor: color,
                linewidth: settings.lineWidth,
                linestyle: LINE_STYLES[settings.lineStyle] ?? 0,
                extendLeft: false,
                intervalsVisibilities: ALL_INTERVALS_VISIBLE,
            },
        }));
        if (id === null || id === undefined) return null;
        try {
            const shape = chart.getShapeById(id);
            if (shape && typeof shape.setProperties === 'function') {
                shape.setProperties({ intervalsVisibilities: ALL_INTERVALS_VISIBLE });
            }
        } catch {
            return id;
        }
        return id;
    };

    const drawSpiderlines = async () => {
        const chart = getChart();
        if (!chart) return setStatus('TradingView API not found. Reload the chart page.', true);
        if (!Number.isFinite(settings.anchorTime) || !Number.isFinite(settings.anchorPrice)) {
            return setStatus('Set an anchor first (Pick on chart or type time and price).', true);
        }
        if (!settings.showHighs && !settings.showLows) return setStatus('Enable Highs and/or Lows.', true);
        const bars = await readBars(chart);
        if (!bars) return setStatus('Could not read chart bars.', true);
        const anchorIndex = findBarIndexAtOrBefore(bars, settings.anchorTime);
        if (anchorIndex < 0) {
            return setStatus('Anchor is older than the loaded history. Scroll left to load more bars.', true);
        }
        const pivots = [
            ...(settings.showHighs ? findPivots(bars, anchorIndex, settings.highLeft, settings.highRight, true) : []),
            ...(settings.showLows ? findPivots(bars, anchorIndex, settings.lowLeft, settings.lowRight, false) : []),
        ].sort((a, b) => b.index - a.index).slice(0, Math.max(1, settings.maxLines));
        if (!pivots.length) return setStatus('No confirmed pivots after the anchor.', true);
        const from = { time: settings.anchorTime, price: settings.anchorPrice };
        const key = drawingsKey(chart);
        const records = safeRead(key, []);
        let created = 0;
        for (const pivot of pivots.reverse()) {
            const to = { time: pivot.time, price: pivot.price };
            try {
                const id = await createRay(chart, from, to, pivot.isHigh ? settings.highColor : settings.lowColor);
                if (id !== null) {
                    records.push({ id, from, to });
                    created++;
                }
            } catch (error) {
                setStatus(`Ray creation failed: ${error && error.message ? error.message : error}`, true);
            }
        }
        safeWrite(key, records);
        setStatus(`Drew ${created} rays on ${getSymbol(chart)}. Visible on every timeframe.`);
    };

    const snapPrice = async (chart, time, price, mode) => {
        const bars = await readBars(chart);
        if (!bars) return price;
        const index = findBarIndexAtOrBefore(bars, time);
        if (index < 0) return price;
        const bar = bars[index];
        if (mode === 'high') return bar.high;
        if (mode === 'low') return bar.low;
        return Math.abs(price - bar.high) <= Math.abs(price - bar.low) ? bar.high : bar.low;
    };

    const alignTimeToBar = async (chart, time) => {
        const bars = await readBars(chart);
        if (!bars) return time;
        const index = findBarIndexAtOrBefore(bars, time);
        return index < 0 ? time : bars[index].time;
    };

    let pickState = null;

    const stopPicking = () => {
        if (!pickState) return;
        const state = pickState;
        pickState = null;
        document.removeEventListener('click', state.onClick, true);
        try {
            state.chart.crossHairMoved().unsubscribe(null, state.onMove);
        } catch {
            state.onMove = null;
        }
        ui.pickButton.textContent = 'Pick on chart';
    };

    const startPicking = () => {
        if (pickState) return stopPicking();
        const chart = getChart();
        if (!chart || typeof chart.crossHairMoved !== 'function') {
            return setStatus('Crosshair API not available. Type time and price manually.', true);
        }
        const state = { chart, last: null };
        state.onMove = point => {
            state.last = point;
        };
        state.onClick = async event => {
            if (ui.panel.contains(event.target)) return;
            if (!event.target.closest('.chart-container, .chart-gui-wrapper, .chart-markup-table')) return;
            const point = state.last;
            stopPicking();
            if (!point || !Number.isFinite(point.time) || !Number.isFinite(point.price)) {
                return setStatus('No crosshair position captured. Try again.', true);
            }
            const time = await alignTimeToBar(chart, point.time);
            const price = settings.snapToWick ? await snapPrice(chart, time, point.price, 'nearest') : point.price;
            settings.anchorTime = time;
            settings.anchorPrice = price;
            saveSettings();
            syncInputs();
            setStatus('Anchor set. Press Draw.');
        };
        chart.crossHairMoved().subscribe(null, state.onMove);
        document.addEventListener('click', state.onClick, true);
        pickState = state;
        ui.pickButton.textContent = 'Cancel pick';
        setStatus('Click the anchor candle on the chart.');
    };

    const snapAnchor = async mode => {
        const chart = getChart();
        if (!chart || !Number.isFinite(settings.anchorTime)) return setStatus('Set an anchor time first.', true);
        settings.anchorTime = await alignTimeToBar(chart, settings.anchorTime);
        settings.anchorPrice = await snapPrice(chart, settings.anchorTime, settings.anchorPrice ?? 0, mode);
        saveSettings();
        syncInputs();
        setStatus(`Anchor snapped to candle ${mode}.`);
    };

    const STYLE = `
        #spiderlines-panel { position: fixed; z-index: 99999; width: 280px; background: #1e222d; color: #d1d4dc;
            border: 1px solid #363a45; border-radius: 6px; font: 12px -apple-system, Segoe UI, Roboto, sans-serif;
            box-shadow: 0 4px 16px rgba(0,0,0,.4); user-select: none; }
        #spiderlines-panel .sl-header { display: flex; justify-content: space-between; align-items: center;
            padding: 6px 8px; cursor: move; background: #2a2e39; border-radius: 6px 6px 0 0; font-weight: 600; }
        #spiderlines-panel .sl-body { padding: 6px 8px 8px; }
        #spiderlines-panel.sl-collapsed .sl-body { display: none; }
        #spiderlines-panel .sl-section { margin: 8px 0 4px; color: #787b86; font-family: monospace; }
        #spiderlines-panel .sl-row { display: flex; align-items: center; gap: 4px; margin: 3px 0; }
        #spiderlines-panel input, #spiderlines-panel select, #spiderlines-panel button {
            background: #131722; color: #d1d4dc; border: 1px solid #363a45; border-radius: 3px; font: inherit; padding: 2px 4px; }
        #spiderlines-panel input[type=number] { width: 44px; }
        #spiderlines-panel input[type=color] { width: 28px; height: 20px; padding: 0; }
        #spiderlines-panel input[type=checkbox] { margin: 0 2px 0 0; }
        #spiderlines-panel .sl-grow { flex: 1; min-width: 0; }
        #spiderlines-panel button { cursor: pointer; }
        #spiderlines-panel button:hover { background: #2a2e39; }
        #spiderlines-panel .sl-primary { background: #2962ff; border-color: #2962ff; color: #fff; }
        #spiderlines-panel .sl-primary:hover { background: #1e53e5; }
        #spiderlines-panel .sl-status { margin-top: 6px; color: #787b86; min-height: 14px; }
        #spiderlines-panel .sl-status.sl-error { color: #f23645; }
        #spiderlines-panel .sl-toggle { background: none; border: none; padding: 0 4px; }
    `;

    const PANEL_HTML = `
        <div class="sl-header"><span>PaintFloid's Spiderlines</span><button class="sl-toggle" data-action="toggle" title="Collapse or expand the panel">_</button></div>
        <div class="sl-body">
            <div class="sl-section">#### ANCHOR ####</div>
            <div class="sl-row">
                <button data-action="pick" class="sl-grow" title="Arm the picker, then click the anchor candle on the chart. Time is aligned to the candle open of the current timeframe.">Pick on chart</button>
                <label title="When picking, snap the price to the nearest wick (high or low) of the clicked candle."><input type="checkbox" data-key="snapToWick">Snap wick</label>
            </div>
            <div class="sl-row"><span title="Anchor candle time in your local timezone.">Time</span><input type="datetime-local" data-key="anchorTime" class="sl-grow" title="Anchor candle time in your local timezone."></div>
            <div class="sl-row"><span title="Anchor price. Every ray starts here.">Price</span><input type="number" step="any" data-key="anchorPrice" class="sl-grow" title="Anchor price. Every ray starts here."></div>
            <div class="sl-row">
                <button data-action="snap-high" class="sl-grow" title="Set the anchor price to the high of the anchor candle.">Snap high</button>
                <button data-action="snap-low" class="sl-grow" title="Set the anchor price to the low of the anchor candle.">Snap low</button>
            </div>
            <div class="sl-section">#### PIVOTS ####</div>
            <div class="sl-row" title="Draw rays to confirmed pivot highs after the anchor. Left/Right are the bars required on each side, like ta.pivothigh.">
                <label class="sl-grow"><input type="checkbox" data-key="showHighs">Highs</label>
                <input type="color" data-key="highColor"><input type="number" min="1" max="50" data-key="highLeft" title="Left bars"><input type="number" min="1" max="50" data-key="highRight" title="Right bars">
            </div>
            <div class="sl-row" title="Draw rays to confirmed pivot lows after the anchor. Left/Right are the bars required on each side, like ta.pivotlow.">
                <label class="sl-grow"><input type="checkbox" data-key="showLows">Lows</label>
                <input type="color" data-key="lowColor"><input type="number" min="1" max="50" data-key="lowLeft" title="Left bars"><input type="number" min="1" max="50" data-key="lowRight" title="Right bars">
            </div>
            <div class="sl-row"><span class="sl-grow" title="Maximum rays per draw. The most recent pivots are kept.">Max lines</span><input type="number" min="1" max="500" data-key="maxLines" title="Maximum rays per draw. The most recent pivots are kept."></div>
            <div class="sl-section">#### STYLE ####</div>
            <div class="sl-row">
                <span class="sl-grow" title="Ray width and style.">Width / Style</span>
                <input type="number" min="1" max="4" data-key="lineWidth" title="Ray width">
                <select data-key="lineStyle" title="Ray style"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select>
            </div>
            <div class="sl-row" style="margin-top:8px">
                <button data-action="draw" class="sl-grow sl-primary" title="Draw native rays from the anchor to each confirmed pivot on the current timeframe.">Draw</button>
                <button data-action="redraw" class="sl-grow" title="Remove the spiderlines of this symbol and draw them again with the current settings.">Redraw</button>
                <button data-action="clear" class="sl-grow" title="Remove every ray created by this script on this symbol, from any timeframe.">Clear</button>
            </div>
            <div class="sl-status"></div>
        </div>
    `;

    const NUMERIC_KEYS = new Set(['anchorPrice', 'highLeft', 'highRight', 'lowLeft', 'lowRight', 'maxLines', 'lineWidth']);
    const ui = {};

    const setStatus = (message, isError = false) => {
        if (!ui.status) return;
        ui.status.textContent = message;
        ui.status.classList.toggle('sl-error', isError);
    };

    const syncInputs = () => {
        ui.panel.querySelectorAll('[data-key]').forEach(input => {
            const key = input.dataset.key;
            const value = settings[key];
            if (input.type === 'checkbox') input.checked = Boolean(value);
            else if (key === 'anchorTime') input.value = toLocalInputValue(value);
            else input.value = value ?? '';
        });
    };

    const readInput = input => {
        const key = input.dataset.key;
        if (input.type === 'checkbox') return input.checked;
        if (key === 'anchorTime') return fromLocalInputValue(input.value);
        if (NUMERIC_KEYS.has(key)) {
            const number = parseFloat(input.value);
            if (!Number.isFinite(number)) return key === 'anchorPrice' ? null : DEFAULT_SETTINGS[key];
            return key === 'anchorPrice' ? number : Math.max(1, Math.round(number));
        }
        return input.value;
    };

    const makeDraggable = (panel, handle) => {
        handle.addEventListener('mousedown', event => {
            if (event.target.closest('button')) return;
            const startX = event.clientX;
            const startY = event.clientY;
            const rect = panel.getBoundingClientRect();
            const onMove = moveEvent => {
                const left = Math.min(Math.max(0, rect.left + moveEvent.clientX - startX), window.innerWidth - 60);
                const top = Math.min(Math.max(0, rect.top + moveEvent.clientY - startY), window.innerHeight - 30);
                panel.style.left = `${left}px`;
                panel.style.top = `${top}px`;
                settings.panelLeft = left;
                settings.panelTop = top;
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                saveSettings();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            event.preventDefault();
        });
    };

    const ACTIONS = {
        toggle: () => {
            settings.collapsed = !settings.collapsed;
            ui.panel.classList.toggle('sl-collapsed', settings.collapsed);
            saveSettings();
        },
        pick: startPicking,
        'snap-high': () => snapAnchor('high'),
        'snap-low': () => snapAnchor('low'),
        draw: drawSpiderlines,
        redraw: async () => {
            const chart = getChart();
            if (chart) clearSpiderlines(chart);
            await drawSpiderlines();
        },
        clear: () => {
            const chart = getChart();
            if (!chart) return setStatus('TradingView API not found.', true);
            setStatus(`Removed ${clearSpiderlines(chart)} rays from ${getSymbol(chart)}.`);
        },
    };

    const buildPanel = () => {
        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.appendChild(style);
        const panel = document.createElement('div');
        panel.id = 'spiderlines-panel';
        panel.innerHTML = PANEL_HTML;
        panel.classList.toggle('sl-collapsed', settings.collapsed);
        panel.style.top = `${settings.panelTop ?? 80}px`;
        panel.style.left = `${settings.panelLeft ?? Math.max(0, window.innerWidth - 340)}px`;
        document.body.appendChild(panel);
        ui.panel = panel;
        ui.status = panel.querySelector('.sl-status');
        ui.pickButton = panel.querySelector('[data-action="pick"]');
        panel.addEventListener('click', event => {
            const button = event.target.closest('[data-action]');
            if (!button) return;
            Promise.resolve(ACTIONS[button.dataset.action]()).catch(error =>
                setStatus(`Error: ${error && error.message ? error.message : error}`, true));
        });
        panel.addEventListener('change', event => {
            const input = event.target.closest('[data-key]');
            if (!input) return;
            settings[input.dataset.key] = readInput(input);
            saveSettings();
        });
        panel.addEventListener('keydown', event => event.stopPropagation());
        makeDraggable(panel, panel.querySelector('.sl-header'));
        syncInputs();
    };

    const API_TIMEOUT_MS = 30000;

    const waitForApi = () => new Promise(resolve => {
        const startedAt = Date.now();
        const check = () => {
            if (getChart()) return resolve(true);
            if (Date.now() - startedAt > API_TIMEOUT_MS) return resolve(false);
            setTimeout(check, 500);
        };
        check();
    });

    const isChartPage = () => location.pathname.startsWith('/chart');

    const start = () => {
        if (!document.body) return setTimeout(start, 200);
        if (!isChartPage()) return;
        if (!ui.panel) buildPanel();
        setStatus('Waiting for TradingView API...');
        waitForApi().then(found => {
            if (found) return setStatus('Ready. Pick an anchor and press Draw.');
            const candidates = Object.keys(pageWindow).filter(key => /tradingview|tvwidget|chart/i.test(key)).slice(0, 10);
            setStatus(`TradingViewApi not found. Window keys: ${candidates.join(', ') || 'none'}`, true);
        });
    };

    start();
})();
