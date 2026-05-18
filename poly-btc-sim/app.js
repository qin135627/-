/**
 * PolyBTC - Polymarket BTC 5-Minute Market Mirror + Paper Trading
 *
 * Strategy: Polymarket's BTC 5-minute markets follow a strict pattern:
 *   slug: btc-updown-5m-{unix_timestamp_aligned_to_5min_boundary}
 *
 * We compute the expected slug from the current time and query directly,
 * which is far more reliable than searching events/markets endpoints.
 */

// ============ CONFIG ============
const CONFIG = {
    GAMMA_API: 'https://gamma-api.polymarket.com',
    CLOB_API: 'https://clob.polymarket.com',
    BINANCE_API: 'https://api.binance.com/api/v3',
    REFRESH_ODDS_MS: 2000,
    REFRESH_PRICE_MS: 2000,
    SEARCH_RETRY_MS: 5000,
};

// ============ STATE ============
const state = {
    balance: 1000,
    positions: [],
    history: [],
    totalTrades: 0,
    wins: 0,
    totalPnl: 0,
    bestTrade: 0,
    market: null,
    slug: null,
    tokenIdYes: null,
    tokenIdNo: null,
    marketEndTime: null,
    marketStartTime: null,
    question: null,
    priceYes: null,
    priceNo: null,
    btcPrice: null,
    btcStartPrice: null,
    currentSide: 'up',
    marketActive: false,
    volume: 0,
    status: 'searching',
    oddsTimer: null,
    priceTimer: null,
    countdownTimer: null,
    searchTimer: null,
};

const $ = (id) => document.getElementById(id);

// ============ MARKET DISCOVERY ============
// Polymarket BTC 5m markets are aligned to 5-minute boundaries (Unix timestamp % 300 == 0)
function getCurrentMarketSlug() {
    const nowSec = Math.floor(Date.now() / 1000);
    const aligned = Math.floor(nowSec / 300) * 300;
    return `btc-updown-5m-${aligned}`;
}

function getNextMarketSlug() {
    const nowSec = Math.floor(Date.now() / 1000);
    const next = Math.ceil(nowSec / 300) * 300;
    return `btc-updown-5m-${next}`;
}

// Fetch market by slug (event endpoint)
async function fetchEventBySlug(slug) {
    try {
        const url = `${CONFIG.GAMMA_API}/events?slug=${encodeURIComponent(slug)}`;
        console.log('[PolyBTC] Trying event slug:', slug);
        const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!resp.ok) {
            console.log('[PolyBTC] event response:', resp.status);
            return null;
        }
        const data = await resp.json();
        console.log('[PolyBTC] event data:', data.length, 'events');
        if (data.length > 0) return data[0];
        return null;
    } catch (e) {
        console.log('[PolyBTC] fetchEventBySlug error:', e.message);
        return null;
    }
}

// Fetch market by slug (markets endpoint)
async function fetchMarketBySlug(slug) {
    try {
        const url = `${CONFIG.GAMMA_API}/markets?slug=${encodeURIComponent(slug)}`;
        console.log('[PolyBTC] Trying market slug:', slug);
        const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!resp.ok) {
            console.log('[PolyBTC] market response:', resp.status);
            return null;
        }
        const data = await resp.json();
        console.log('[PolyBTC] market data:', data.length, 'markets');
        if (data.length > 0) return data[0];
        return null;
    } catch (e) {
        console.log('[PolyBTC] fetchMarketBySlug error:', e.message);
        return null;
    }
}

function buildMarketDataFromEvent(event, slug) {
    if (!event.markets || event.markets.length === 0) {
        // Event itself might have token IDs
        return null;
    }
    const m = event.markets[0];
    return buildMarketDataFromMarket(m, slug, event);
}

function buildMarketDataFromMarket(market, slug, event = null) {
    if (!market) return null;

    const slugParts = slug.split('-');
    const startUnix = parseInt(slugParts[slugParts.length - 1]);
    const startTime = startUnix * 1000;
    const endTime = startTime + 5 * 60 * 1000; // 5 minutes after start

    let tokenIds = null;
    if (market.clobTokenIds) {
        try {
            tokenIds = typeof market.clobTokenIds === 'string'
                ? JSON.parse(market.clobTokenIds)
                : market.clobTokenIds;
        } catch (e) {}
    }
    let prices = null;
    if (market.outcomePrices) {
        try {
            prices = typeof market.outcomePrices === 'string'
                ? JSON.parse(market.outcomePrices)
                : market.outcomePrices;
        } catch (e) {}
    }

    console.log('[PolyBTC] Built market:', slug, 'tokens:', tokenIds, 'prices:', prices);

    return {
        market,
        event,
        slug,
        question: market.question || (event && event.title) || `BTC Up or Down 5m`,
        startTime,
        endTime,
        tokenIdYes: tokenIds ? String(tokenIds[0]) : null,
        tokenIdNo: tokenIds ? String(tokenIds[1]) : null,
        priceYes: prices ? parseFloat(prices[0]) : null,
        priceNo: prices ? parseFloat(prices[1]) : null,
        volume: parseFloat(market.volume || (event && event.volume) || 0),
        conditionId: market.conditionId || null,
    };
}

async function findActiveMarket() {
    // Try the current 5-minute boundary first
    const currentSlug = getCurrentMarketSlug();
    console.log('[PolyBTC] Computed current slug:', currentSlug);

    // Try fetching by event slug
    let event = await fetchEventBySlug(currentSlug);
    if (event) {
        const md = buildMarketDataFromEvent(event, currentSlug);
        if (md && md.tokenIdYes) {
            console.log('[PolyBTC] Found via event:', currentSlug);
            return md;
        }
    }

    // Try fetching by market slug
    let market = await fetchMarketBySlug(currentSlug);
    if (market) {
        const md = buildMarketDataFromMarket(market, currentSlug);
        if (md && md.tokenIdYes) {
            console.log('[PolyBTC] Found via market:', currentSlug);
            return md;
        }
    }

    // Try previous 5-min boundary (in case current is mid-cycle)
    const prevSlug = `btc-updown-5m-${(Math.floor(Date.now()/1000/300)-1)*300}`;
    console.log('[PolyBTC] Trying previous slug:', prevSlug);
    event = await fetchEventBySlug(prevSlug);
    if (event) {
        const md = buildMarketDataFromEvent(event, prevSlug);
        if (md && md.tokenIdYes && md.endTime > Date.now()) {
            console.log('[PolyBTC] Found via previous slug:', prevSlug);
            return md;
        }
    }
    market = await fetchMarketBySlug(prevSlug);
    if (market) {
        const md = buildMarketDataFromMarket(market, prevSlug);
        if (md && md.tokenIdYes && md.endTime > Date.now()) {
            console.log('[PolyBTC] Found via previous market slug:', prevSlug);
            return md;
        }
    }

    // Fallback: search all events for any btc-updown-5m
    console.log('[PolyBTC] Fallback: searching all events...');
    try {
        const resp = await fetch(
            `${CONFIG.GAMMA_API}/events?active=true&closed=false&limit=100`,
            { signal: AbortSignal.timeout(10000) }
        );
        if (resp.ok) {
            const events = await resp.json();
            console.log('[PolyBTC] Got', events.length, 'events');
            const btcEvents = events.filter(e =>
                e.slug && e.slug.startsWith('btc-updown-5m-')
            );
            console.log('[PolyBTC] btc-updown-5m events:', btcEvents.length, btcEvents.map(e => e.slug));
            const now = Date.now();
            for (const e of btcEvents) {
                const md = buildMarketDataFromEvent(e, e.slug);
                if (md && md.tokenIdYes && md.endTime > now) {
                    return md;
                }
            }
        }
    } catch (e) {
        console.log('[PolyBTC] fallback error:', e.message);
    }

    return null;
}

// ============ CLOB API ============
async function fetchMidpoint(tokenId) {
    try {
        const resp = await fetch(
            `${CONFIG.CLOB_API}/midpoint?token_id=${tokenId}`,
            { signal: AbortSignal.timeout(5000) }
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.mid ? parseFloat(data.mid) : null;
    } catch (e) {
        return null;
    }
}

async function fetchPrice(tokenId, side) {
    try {
        const resp = await fetch(
            `${CONFIG.CLOB_API}/price?token_id=${tokenId}&side=${side || 'buy'}`,
            { signal: AbortSignal.timeout(5000) }
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.price ? parseFloat(data.price) : null;
    } catch (e) {
        return null;
    }
}

async function refreshOdds() {
    if (!state.tokenIdYes) return;
    let price = await fetchMidpoint(state.tokenIdYes);
    if (price === null) price = await fetchPrice(state.tokenIdYes, 'buy');
    if (price !== null && price > 0 && price < 1) {
        state.priceYes = price;
        state.priceNo = 1 - price;
        renderOdds();
        renderTradeSummary();
    }
}

// ============ BTC PRICE ============
async function fetchBtcPrice() {
    try {
        const resp = await fetch(
            `${CONFIG.BINANCE_API}/ticker/price?symbol=BTCUSDT`,
            { signal: AbortSignal.timeout(3000) }
        );
        if (resp.ok) {
            const data = await resp.json();
            state.btcPrice = parseFloat(data.price);
            renderBtcPrice();
            return;
        }
    } catch (e) {}
    try {
        const resp = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
            { signal: AbortSignal.timeout(3000) }
        );
        if (resp.ok) {
            const data = await resp.json();
            state.btcPrice = data.bitcoin.usd;
            renderBtcPrice();
        }
    } catch (e) {}
}

// ============ MARKET LIFECYCLE ============
async function searchAndConnect() {
    setStatus('searching');
    stopAllTimers();
    showToast('Searching for BTC 5m market on Polymarket...', 'info');

    const md = await findActiveMarket();
    if (!md) {
        setStatus('waiting');
        showToast('No active BTC 5m market. Retrying in 5s...', 'info');
        state.searchTimer = setTimeout(searchAndConnect, CONFIG.SEARCH_RETRY_MS);
        return;
    }

    connectToMarket(md);
}

function connectToMarket(md) {
    state.market = md;
    state.slug = md.slug;
    state.question = md.question;
    state.tokenIdYes = md.tokenIdYes;
    state.tokenIdNo = md.tokenIdNo;
    state.marketStartTime = md.startTime;
    state.marketEndTime = md.endTime;
    state.volume = Math.round(md.volume || 0);
    state.positions = [];
    state.marketActive = true;
    state.priceYes = md.priceYes !== null ? md.priceYes : 0.5;
    state.priceNo = md.priceNo !== null ? md.priceNo : 0.5;

    fetchBtcPrice().then(() => {
        state.btcStartPrice = state.btcPrice;
        renderStartPrice();
    });

    setStatus('live');
    renderMarketInfo();
    renderOdds();
    renderBalance();
    renderPositions();

    showToast(`Connected: ${md.question}`, 'success');

    state.oddsTimer = setInterval(refreshOdds, CONFIG.REFRESH_ODDS_MS);
    state.priceTimer = setInterval(fetchBtcPrice, CONFIG.REFRESH_PRICE_MS);
    state.countdownTimer = setInterval(() => {
        const remaining = Math.max(0, Math.floor((state.marketEndTime - Date.now()) / 1000));
        renderCountdown(remaining);
        if (remaining <= 0) resolveMarket();
    }, 1000);

    refreshOdds();
}

function resolveMarket() {
    stopAllTimers();
    state.marketActive = false;
    setStatus('resolved');

    const outcome = state.btcPrice >= state.btcStartPrice ? 'up' : 'down';
    let roundPnl = 0;
    let roundWon = false;

    state.positions.forEach(pos => {
        const won = pos.side === outcome;
        const payout = won ? pos.shares : 0;
        const pnl = payout - pos.cost;
        if (won) { state.balance += payout; roundWon = true; }
        roundPnl += pnl;
        state.history.push({
            side: pos.side, cost: pos.cost, shares: pos.shares,
            price: pos.price, pnl, won, outcome,
            timestamp: Date.now(), question: state.question,
        });
        state.totalTrades++;
        if (won) state.wins++;
        state.totalPnl += pnl;
        if (pnl > state.bestTrade) state.bestTrade = pnl;
    });

    renderBalance();
    renderHistory();
    renderStats();

    if (state.positions.length > 0) {
        showModal(outcome, roundPnl, roundWon);
    } else {
        showToast(`Resolved: ${outcome.toUpperCase()}. Finding next market...`, 'info');
        setTimeout(searchAndConnect, 2000);
    }
}

function stopAllTimers() {
    if (state.oddsTimer) { clearInterval(state.oddsTimer); state.oddsTimer = null; }
    if (state.priceTimer) { clearInterval(state.priceTimer); state.priceTimer = null; }
    if (state.countdownTimer) { clearInterval(state.countdownTimer); state.countdownTimer = null; }
    if (state.searchTimer) { clearTimeout(state.searchTimer); state.searchTimer = null; }
}

// ============ PAPER TRADING ============
function placeTrade() {
    if (!state.marketActive) return showToast('No active market', 'error');
    if (state.priceYes === null) return showToast('Waiting for price data...', 'error');
    const amount = parseFloat($('trade-amount').value);
    if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');
    if (amount > state.balance) return showToast('Insufficient balance', 'error');

    const side = state.currentSide;
    const price = side === 'up' ? state.priceYes : state.priceNo;
    const shares = amount / price;

    state.balance -= amount;
    state.positions.push({ side, shares, price, cost: amount, timestamp: Date.now() });

    renderBalance();
    renderPositions();
    showToast(`Bought ${shares.toFixed(2)} ${side.toUpperCase()} @ $${price.toFixed(3)}`, 'success');
}

// ============ RENDERING ============
function setStatus(status) {
    state.status = status;
    const tag = $('market-status-tag');
    const source = $('data-source');
    const dot = source.querySelector('.source-dot');
    const label = source.querySelector('.source-text');
    const btn = $('place-trade-btn');

    switch(status) {
        case 'searching':
            tag.textContent = 'SEARCHING';
            tag.className = 'tag live';
            dot.className = 'source-dot';
            label.textContent = 'Connecting to Polymarket API...';
            btn.disabled = true;
            break;
        case 'live':
            tag.textContent = 'LIVE';
            tag.className = 'tag live';
            dot.className = 'source-dot live';
            label.textContent = 'Polymarket Live (Gamma + CLOB)';
            btn.disabled = false;
            break;
        case 'waiting':
            tag.textContent = 'WAITING';
            tag.className = 'tag crypto';
            dot.className = 'source-dot sim';
            label.textContent = 'Waiting for next BTC 5m market...';
            btn.disabled = true;
            break;
        case 'resolved':
            tag.textContent = 'RESOLVED';
            tag.className = 'tag ended';
            dot.className = 'source-dot';
            label.textContent = 'Market ended. Searching for next...';
            btn.disabled = true;
            break;
    }
}

function renderMarketInfo() {
    $('market-title').textContent = state.question || 'BTC Up or Down - 5 Minutes';
    const link = $('market-link');
    if (state.slug) {
        link.href = `https://polymarket.com/event/${state.slug}`;
        link.style.display = 'inline';
    }
    renderVolume();
    renderStartPrice();
}

function renderOdds() {
    if (state.priceYes === null) return;
    const upPct = Math.round(state.priceYes * 100);
    const downPct = 100 - upPct;
    $('odds-up').textContent = `${upPct}%`;
    $('odds-down').textContent = `${downPct}%`;
    $('price-up').textContent = `$${state.priceYes.toFixed(3)}`;
    $('price-down').textContent = `$${state.priceNo.toFixed(3)}`;
    $('odds-bar-up').style.width = `${upPct}%`;
    $('odds-bar-down').style.width = `${downPct}%`;
}

function renderCountdown(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    $('countdown').textContent = `${m}:${s.toString().padStart(2,'0')}`;
    const el = $('countdown');
    if (seconds <= 30) el.style.color = 'var(--down-color)';
    else if (seconds <= 60) el.style.color = '#f59e0b';
    else el.style.color = 'var(--accent)';
}

function renderBtcPrice() {
    if (!state.btcPrice) return;
    $('btc-price').textContent = `$${state.btcPrice.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    if (state.btcStartPrice) {
        const change = state.btcPrice - state.btcStartPrice;
        const pct = (change / state.btcStartPrice) * 100;
        const sign = change >= 0 ? '+' : '';
        const el = $('btc-change');
        el.textContent = `${sign}$${change.toFixed(2)} (${sign}${pct.toFixed(3)}%)`;
        el.className = `price-change ${change >= 0 ? 'up' : 'down'}`;
    }
}

function renderStartPrice() {
    $('start-price').textContent = state.btcStartPrice
        ? `$${state.btcStartPrice.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`
        : '--';
}

function renderVolume() {
    $('volume').textContent = state.volume ? `$${state.volume.toLocaleString()}` : '--';
}

function renderBalance() {
    const el = $('balance');
    el.textContent = `$${state.balance.toFixed(2)}`;
    el.style.color = state.balance >= 1000 ? 'var(--up-color)' :
                     state.balance >= 500 ? 'var(--text-primary)' : 'var(--down-color)';
}

function renderTradeSummary() {
    const amount = parseFloat($('trade-amount').value) || 0;
    const price = state.currentSide === 'up' ? (state.priceYes || 0.5) : (state.priceNo || 0.5);
    const shares = price > 0 ? amount / price : 0;
    const profit = shares - amount;
    const profitPct = amount > 0 ? (profit / amount) * 100 : 0;
    $('shares-count').textContent = shares.toFixed(2);
    $('avg-price').textContent = `$${price.toFixed(3)}`;
    $('potential-payout').textContent = `$${shares.toFixed(2)}`;
    $('potential-profit').textContent = `+$${profit.toFixed(2)} (${profitPct.toFixed(0)}%)`;
}

function renderPositions() {
    const section = $('positions-section');
    const list = $('positions-list');
    if (state.positions.length === 0) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    list.innerHTML = state.positions.map(pos => `
        <div class="position-item">
            <div><span class="position-side ${pos.side}">${pos.side === 'up' ? '&#9650; UP' : '&#9660; DOWN'}</span></div>
            <div class="position-details">
                <div class="position-shares">${pos.shares.toFixed(2)} shares</div>
                <div class="position-cost">$${pos.cost.toFixed(2)} @ $${pos.price.toFixed(3)}</div>
            </div>
        </div>
    `).join('');
}

function renderHistory() {
    const list = $('history-list');
    if (state.history.length === 0) {
        list.innerHTML = '<div class="history-empty">No trades yet.</div>';
        return;
    }
    list.innerHTML = state.history.slice(-20).reverse().map(t => `
        <div class="history-item ${t.won ? 'win' : 'loss'}">
            <div>
                <span class="history-side">${t.side === 'up' ? '&#9650; UP' : '&#9660; DOWN'}</span>
                <span style="color:var(--text-muted); margin-left:8px; font-size:11px;">$${t.cost.toFixed(0)}</span>
            </div>
            <span class="history-pnl">${t.won ? '+' : ''}$${t.pnl.toFixed(2)}</span>
        </div>
    `).join('');
}

function renderStats() {
    $('stat-trades').textContent = state.totalTrades;
    $('stat-winrate').textContent = state.totalTrades > 0
        ? `${Math.round(state.wins / state.totalTrades * 100)}%` : '0%';
    const pnlEl = $('stat-pnl');
    pnlEl.textContent = `${state.totalPnl >= 0 ? '+' : ''}$${state.totalPnl.toFixed(2)}`;
    pnlEl.style.color = state.totalPnl >= 0 ? 'var(--up-color)' : 'var(--down-color)';
    $('stat-best').textContent = `+$${state.bestTrade.toFixed(2)}`;
}

function showModal(outcome, pnl, won) {
    $('modal-icon').innerHTML = won ? '&#127881;' : '&#128546;';
    $('modal-title').textContent = won ? 'You Won!' : 'Market Resolved';
    $('modal-result').textContent = `BTC went ${outcome.toUpperCase()} in this 5-minute window.`;
    const change = (state.btcPrice || 0) - (state.btcStartPrice || 0);
    const pct = state.btcStartPrice ? (change / state.btcStartPrice) * 100 : 0;
    $('modal-details').innerHTML = `
        <div class="detail-row"><span>Start Price</span><span>$${(state.btcStartPrice||0).toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
        <div class="detail-row"><span>End Price</span><span>$${(state.btcPrice||0).toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
        <div class="detail-row"><span>Change</span><span style="color:${change>=0?'var(--up-color)':'var(--down-color)'}">${change>=0?'+':''}$${change.toFixed(2)} (${pct>=0?'+':''}${pct.toFixed(3)}%)</span></div>
        <div class="detail-row"><span>Outcome</span><span style="color:${outcome==='up'?'var(--up-color)':'var(--down-color)'}; font-weight:700;">${outcome==='up'?'&#9650; UP':'&#9660; DOWN'}</span></div>
        <div class="detail-row" style="border-top:1px solid var(--border); padding-top:8px; margin-top:4px;">
            <span>Your P&L</span>
            <span style="color:${pnl>=0?'var(--up-color)':'var(--down-color)'}; font-weight:700; font-size:16px;">${pnl>=0?'+':''}$${pnl.toFixed(2)}</span>
        </div>
    `;
    $('modal-overlay').style.display = 'flex';
}

function showToast(message, type = 'info') {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function setupEvents() {
    $('tab-up').addEventListener('click', () => {
        state.currentSide = 'up';
        $('tab-up').classList.add('active');
        $('tab-down').classList.remove('active');
        $('place-trade-btn').className = 'trade-btn';
        $('place-trade-btn').innerHTML = 'Buy UP &#9650;';
        renderTradeSummary();
    });
    $('tab-down').addEventListener('click', () => {
        state.currentSide = 'down';
        $('tab-down').classList.add('active');
        $('tab-up').classList.remove('active');
        $('place-trade-btn').className = 'trade-btn down-active';
        $('place-trade-btn').innerHTML = 'Buy DOWN &#9660;';
        renderTradeSummary();
    });
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $('trade-amount').value = btn.dataset.amount;
            renderTradeSummary();
        });
    });
    $('trade-amount').addEventListener('input', renderTradeSummary);
    $('place-trade-btn').addEventListener('click', placeTrade);
    $('modal-close-btn').addEventListener('click', () => {
        $('modal-overlay').style.display = 'none';
        state.positions = [];
        renderPositions();
        searchAndConnect();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && state.marketActive && $('modal-overlay').style.display === 'none') {
            placeTrade();
        }
    });
}

async function init() {
    setupEvents();
    renderBalance();
    renderTradeSummary();
    renderHistory();
    renderStats();
    showToast('Connecting to Polymarket...', 'info');
    await searchAndConnect();
}

document.addEventListener('DOMContentLoaded', init);
