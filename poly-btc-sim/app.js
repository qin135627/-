/**
 * PolyBTC Sim - Real-time Polymarket BTC 5-minute prediction tracker
 * 
 * Connects to LIVE Polymarket data:
 * - Gamma API: discovers current active BTC 5m market (slug: btc-updown-5m-{timestamp})
 * - CLOB API: fetches real-time midpoint prices for odds
 * - WebSocket: wss://ws-subscriptions-clob.polymarket.com/ws/market for streaming
 * - Binance API: real BTC price
 * 
 * The countdown syncs with the ACTUAL market end time from Polymarket.
 */

// ============ CONFIG ============
const CONFIG = {
    GAMMA_API: 'https://gamma-api.polymarket.com',
    CLOB_API: 'https://clob.polymarket.com',
    WS_URL: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    BINANCE_API: 'https://api.binance.com/api/v3',
    POLL_INTERVAL: 5000,      // Poll odds every 5 seconds
    PRICE_INTERVAL: 3000,     // BTC price every 3 seconds
    MARKET_SEARCH_INTERVAL: 10000, // Look for new market every 10s when none active
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

    // Live market data from Polymarket
    market: null,           // Current active market object from Gamma API
    tokenIdUp: null,        // CLOB token ID for "Up" (Yes)
    tokenIdDown: null,      // CLOB token ID for "Down" (No)
    marketEndTime: null,    // Actual end time (Date) from Polymarket
    marketStartTime: null,  // Start time derived from slug

    // Current odds from CLOB
    oddsUp: 0.50,
    oddsDown: 0.50,

    // BTC price
    btcPrice: null,
    btcStartPrice: null,

    // UI state
    currentSide: 'up',
    marketActive: false,
    countdown: 300,
    volume: 0,

    // Connection status
    connected: false,
    dataSource: 'connecting',
    ws: null,

    // Intervals
    oddsInterval: null,
    priceInterval: null,
    countdownInterval: null,
    marketSearchInterval: null,
};

// ============ DOM ============
const DOM = {};
function initDOM() {
    const ids = [
        'balance', 'btc-price', 'btc-change', 'start-price', 'countdown',
        'volume', 'odds-up', 'odds-down', 'price-up', 'price-down',
        'odds-bar-up', 'odds-bar-down', 'trade-amount', 'shares-count',
        'avg-price', 'potential-payout', 'potential-profit', 'place-trade-btn',
        'tab-up', 'tab-down', 'positions-section', 'positions-list',
        'history-list', 'toast-container', 'modal-overlay', 'modal-icon',
        'modal-title', 'modal-result', 'modal-details', 'modal-close-btn',
        'data-source', 'market-title', 'market-status-tag',
        'stat-trades', 'stat-winrate', 'stat-pnl', 'stat-best',
        'market-link',
    ];
    ids.forEach(id => {
        DOM[id.replace(/-/g, '_')] = document.getElementById(id);
    });
}

// ============ POLYMARKET: FIND ACTIVE MARKET ============
async function findActiveMarket() {
    try {
        // Strategy 1: Search Gamma API for active btc-updown-5m events
        const resp = await fetch(
            `${CONFIG.GAMMA_API}/events?slug_contains=btc-updown-5m&active=true&closed=false&limit=5&order=endDate&ascending=true`,
            { signal: AbortSignal.timeout(8000) }
        );

        if (!resp.ok) throw new Error(`Gamma API ${resp.status}`);
        const events = await resp.json();

        if (events.length === 0) {
            // Try markets endpoint directly
            return await findActiveMarketDirect();
        }

        // Find the event that is currently running (not yet ended)
        const now = Date.now();
        for (const event of events) {
            if (!event.markets || event.markets.length === 0) continue;
            const market = event.markets[0];

            // Parse end date
            const endDate = new Date(market.endDate || event.endDate);
            if (endDate.getTime() <= now) continue; // Already ended

            // Parse start time from slug (btc-updown-5m-{unix_seconds})
            const slugParts = (event.slug || '').split('-');
            const startTimestamp = parseInt(slugParts[slugParts.length - 1]) * 1000;
            if (isNaN(startTimestamp)) continue;

            // Check if market has started
            if (startTimestamp > now) continue; // Not started yet

            // Found active market!
            return {
                event,
                market,
                startTime: new Date(startTimestamp),
                endTime: endDate,
                tokenIds: market.clobTokenIds ? JSON.parse(market.clobTokenIds) : null,
                outcomePrices: market.outcomePrices ? JSON.parse(market.outcomePrices) : null,
                question: market.question || event.title,
                slug: event.slug,
                volume: market.volume || event.volume || 0,
            };
        }

        // If no currently-active one found, get the next upcoming one
        for (const event of events) {
            if (!event.markets || event.markets.length === 0) continue;
            const market = event.markets[0];
            const endDate = new Date(market.endDate || event.endDate);
            if (endDate.getTime() <= now) continue;

            const slugParts = (event.slug || '').split('-');
            const startTimestamp = parseInt(slugParts[slugParts.length - 1]) * 1000;

            return {
                event,
                market,
                startTime: new Date(startTimestamp),
                endTime: endDate,
                tokenIds: market.clobTokenIds ? JSON.parse(market.clobTokenIds) : null,
                outcomePrices: market.outcomePrices ? JSON.parse(market.outcomePrices) : null,
                question: market.question || event.title,
                slug: event.slug,
                volume: market.volume || event.volume || 0,
            };
        }

        return null;
    } catch (err) {
        console.error('findActiveMarket error:', err);
        return null;
    }
}

async function findActiveMarketDirect() {
    try {
        const resp = await fetch(
            `${CONFIG.GAMMA_API}/markets?slug_contains=btc-updown-5m&active=true&closed=false&limit=5&order=endDate&ascending=true`,
            { signal: AbortSignal.timeout(8000) }
        );
        if (!resp.ok) return null;
        const markets = await resp.json();

        const now = Date.now();
        for (const market of markets) {
            const endDate = new Date(market.endDate);
            if (endDate.getTime() <= now) continue;

            // Extract start time from slug
            const slugParts = (market.slug || '').split('-');
            const startTimestamp = parseInt(slugParts[slugParts.length - 1]) * 1000;
            if (isNaN(startTimestamp) || startTimestamp > now) continue;

            return {
                event: null,
                market,
                startTime: new Date(startTimestamp),
                endTime: endDate,
                tokenIds: market.clobTokenIds ? JSON.parse(market.clobTokenIds) : null,
                outcomePrices: market.outcomePrices ? JSON.parse(market.outcomePrices) : null,
                question: market.question,
                slug: market.slug,
                volume: market.volume || 0,
            };
        }
        return null;
    } catch (err) {
        console.error('findActiveMarketDirect error:', err);
        return null;
    }
}

// ============ POLYMARKET: FETCH ODDS ============
async function fetchOddsFromCLOB(tokenId) {
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

async function refreshOdds() {
    if (!state.tokenIdUp) return;

    const mid = await fetchOddsFromCLOB(state.tokenIdUp);
    if (mid !== null) {
        state.oddsUp = mid;
        state.oddsDown = 1 - mid;
        state.connected = true;
        updateOddsUI();
    }
}

// ============ WEBSOCKET: REAL-TIME PRICE STREAM ============
function connectWebSocket() {
    if (!state.tokenIdUp) return;

    try {
        const ws = new WebSocket(CONFIG.WS_URL);

        ws.onopen = () => {
            console.log('WebSocket connected');
            // Subscribe to the market's token
            const subscribeMsg = JSON.stringify({
                auth: {},
                type: 'market',
                assets_id: state.tokenIdUp,
            });
            ws.send(subscribeMsg);
            updateDataSourceUI(true, 'Polymarket WebSocket (Live)');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Handle price_change events
                if (data.event_type === 'price_change' || data.price) {
                    const price = parseFloat(data.price || data.yes_price || data.mid);
                    if (price && price > 0 && price < 1) {
                        state.oddsUp = price;
                        state.oddsDown = 1 - price;
                        updateOddsUI();
                    }
                }
                // Handle last_trade_price
                if (data.event_type === 'last_trade_price') {
                    const price = parseFloat(data.price);
                    if (price && price > 0 && price < 1) {
                        state.oddsUp = price;
                        state.oddsDown = 1 - price;
                        updateOddsUI();
                    }
                }
            } catch (e) {
                // Ignore parse errors
            }
        };

        ws.onerror = (err) => {
            console.log('WebSocket error, falling back to polling:', err);
            updateDataSourceUI(true, 'Polymarket CLOB (Polling)');
        };

        ws.onclose = () => {
            console.log('WebSocket closed');
            state.ws = null;
        };

        state.ws = ws;
    } catch (e) {
        console.log('WebSocket not available, using polling');
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
            updateBtcPriceUI();
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
            updateBtcPriceUI();
            return;
        }
    } catch (e) {}

    // Simulate if no API available
    if (!state.btcPrice) state.btcPrice = 103000 + Math.random() * 2000;
    const vol = 0.0005;
    state.btcPrice *= (1 + (Math.random() - 0.5) * vol);
    updateBtcPriceUI();
}



// ============ MARKET LIFECYCLE ============
async function startMarketTracking() {
    // Clear any existing intervals
    stopAllIntervals();

    showToast('Searching for active Polymarket BTC 5m market...', 'info');
    updateDataSourceUI(false, 'Connecting to Polymarket...');

    const marketData = await findActiveMarket();

    if (!marketData) {
        // No active market found - enter simulation mode
        updateDataSourceUI(false, 'No active market - Simulated mode');
        showToast('No active Poly BTC 5m market found. Running simulation.', 'info');
        startSimulationMode();
        return;
    }

    // We found a live market!
    state.market = marketData;
    state.tokenIdUp = marketData.tokenIds ? marketData.tokenIds[0] : null;
    state.tokenIdDown = marketData.tokenIds ? marketData.tokenIds[1] : null;
    state.marketEndTime = marketData.endTime;
    state.marketStartTime = marketData.startTime;
    state.marketActive = true;
    state.connected = true;
    state.volume = Math.round(parseFloat(marketData.volume) || 0);

    // Set initial odds from Gamma API
    if (marketData.outcomePrices) {
        state.oddsUp = parseFloat(marketData.outcomePrices[0]) || 0.5;
        state.oddsDown = parseFloat(marketData.outcomePrices[1]) || 0.5;
    }

    // Get initial BTC price
    await fetchBtcPrice();
    state.btcStartPrice = state.btcPrice;

    // Update UI
    DOM.market_title.textContent = marketData.question || 'BTC Up or Down - 5 Minutes';
    DOM.market_link.href = `https://polymarket.com/event/${marketData.slug}`;
    DOM.market_link.style.display = 'inline';
    DOM.market_status_tag.textContent = 'LIVE';
    DOM.market_status_tag.className = 'tag live';
    DOM.place_trade_btn.disabled = false;
    DOM.start_price.textContent = `$${state.btcStartPrice ? state.btcStartPrice.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '--'}`;

    updateOddsUI();
    updateVolumeUI();
    updateBalance();

    showToast(`Connected! Tracking: ${marketData.question}`, 'success');
    updateDataSourceUI(true, 'Polymarket Gamma + CLOB (Live)');

    // Try WebSocket first, fall back to polling
    connectWebSocket();

    // Start polling as backup/primary
    state.oddsInterval = setInterval(refreshOdds, CONFIG.POLL_INTERVAL);
    state.priceInterval = setInterval(fetchBtcPrice, CONFIG.PRICE_INTERVAL);

    // Start countdown synced to market end time
    startCountdown();
}

function startCountdown() {
    updateCountdownUI();

    state.countdownInterval = setInterval(() => {
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((state.marketEndTime.getTime() - now) / 1000));
        state.countdown = remaining;
        updateCountdownUI();

        if (remaining <= 0) {
            resolveMarket();
        }
    }, 1000);
}

function resolveMarket() {
    stopAllIntervals();
    state.marketActive = false;

    // Determine outcome based on final odds
    // In Polymarket BTC 5m, if odds_up > 0.5 at resolution, UP wins
    // But actual resolution is based on BTC price comparison
    const outcome = state.btcPrice >= state.btcStartPrice ? 'up' : 'down';

    DOM.market_status_tag.textContent = 'RESOLVED';
    DOM.market_status_tag.className = 'tag ended';
    DOM.place_trade_btn.disabled = true;

    // Calculate P&L
    let roundPnl = 0;
    let roundWon = false;

    state.positions.forEach(pos => {
        const won = pos.side === outcome;
        const payout = won ? pos.shares : 0;
        const pnl = payout - pos.cost;

        if (won) {
            state.balance += payout;
            roundWon = true;
        }

        roundPnl += pnl;
        state.history.push({
            side: pos.side,
            cost: pos.cost,
            shares: pos.shares,
            price: pos.price,
            pnl,
            won,
            outcome,
            timestamp: Date.now(),
            question: state.market?.question || 'BTC 5m',
        });

        state.totalTrades++;
        if (won) state.wins++;
        state.totalPnl += pnl;
        if (pnl > state.bestTrade) state.bestTrade = pnl;
    });

    updateBalance();
    updateHistoryUI();
    updateStatsUI();

    if (state.positions.length > 0) {
        showResolutionModal(outcome, roundPnl, roundWon);
    } else {
        showToast(`Market resolved: ${outcome.toUpperCase()}. Looking for next market...`, 'info');
        // Auto-search for next market
        setTimeout(() => {
            state.positions = [];
            startMarketTracking();
        }, 5000);
    }
}

function startSimulationMode() {
    // Simulation fallback when Polymarket API is unavailable
    state.marketActive = true;
    state.marketEndTime = new Date(Date.now() + 300000);
    state.marketStartTime = new Date();
    state.oddsUp = 0.48 + Math.random() * 0.06;
    state.oddsDown = 1 - state.oddsUp;
    state.volume = Math.round(2000 + Math.random() * 8000);

    fetchBtcPrice().then(() => {
        state.btcStartPrice = state.btcPrice;
        DOM.start_price.textContent = `$${state.btcStartPrice ? state.btcStartPrice.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '--'}`;
    });

    const now = new Date();
    const end = new Date(now.getTime() + 300000);
    const fmt = (d) => `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
    DOM.market_title.textContent = `BTC Up or Down - 5 Min (${fmt(now)} - ${fmt(end)}) [Simulated]`;
    DOM.market_link.style.display = 'none';
    DOM.market_status_tag.textContent = 'SIM';
    DOM.market_status_tag.className = 'tag live';
    DOM.place_trade_btn.disabled = false;

    updateOddsUI();
    updateVolumeUI();
    updateBalance();

    startCountdown();
    state.priceInterval = setInterval(async () => {
        await fetchBtcPrice();
        simulateOddsShift();
        updateOddsUI();
    }, CONFIG.PRICE_INTERVAL);
}

function simulateOddsShift() {
    if (!state.btcStartPrice || !state.btcPrice) return;
    const pctChange = (state.btcPrice - state.btcStartPrice) / state.btcStartPrice;
    const momentum = pctChange * 8;
    const noise = (Math.random() - 0.5) * 0.02;
    const timeLeft = state.countdown / 300;
    const timeWeight = 1 - timeLeft * 0.4;

    let target = 0.50 + momentum * timeWeight + noise;
    target = Math.max(0.12, Math.min(0.88, target));
    state.oddsUp = state.oddsUp * 0.75 + target * 0.25;
    state.oddsDown = 1 - state.oddsUp;
}

function stopAllIntervals() {
    if (state.oddsInterval) clearInterval(state.oddsInterval);
    if (state.priceInterval) clearInterval(state.priceInterval);
    if (state.countdownInterval) clearInterval(state.countdownInterval);
    if (state.marketSearchInterval) clearInterval(state.marketSearchInterval);
    if (state.ws) { state.ws.close(); state.ws = null; }
    state.oddsInterval = null;
    state.priceInterval = null;
    state.countdownInterval = null;
    state.marketSearchInterval = null;
}



// ============ UI UPDATES ============
function updateBalance() {
    DOM.balance.textContent = `$${state.balance.toFixed(2)}`;
    DOM.balance.style.color = state.balance >= 1000 ? 'var(--up-color)' :
                              state.balance >= 500 ? 'var(--text-primary)' : 'var(--down-color)';
}

function updateBtcPriceUI() {
    if (!state.btcPrice) return;
    DOM.btc_price.textContent = `$${state.btcPrice.toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    })}`;

    if (state.btcStartPrice) {
        const change = state.btcPrice - state.btcStartPrice;
        const pct = (change / state.btcStartPrice) * 100;
        const sign = change >= 0 ? '+' : '';
        DOM.btc_change.textContent = `${sign}$${change.toFixed(2)} (${sign}${pct.toFixed(3)}%)`;
        DOM.btc_change.className = `price-change ${change >= 0 ? 'up' : 'down'}`;
    }
}

function updateOddsUI() {
    const upPct = Math.round(state.oddsUp * 100);
    const downPct = 100 - upPct;

    DOM.odds_up.textContent = `${upPct}%`;
    DOM.odds_down.textContent = `${downPct}%`;
    DOM.price_up.textContent = `$${state.oddsUp.toFixed(2)}`;
    DOM.price_down.textContent = `$${state.oddsDown.toFixed(2)}`;
    DOM.odds_bar_up.style.width = `${upPct}%`;
    DOM.odds_bar_down.style.width = `${downPct}%`;

    updateTradeSummary();
}

function updateCountdownUI() {
    const now = Date.now();
    const remaining = state.marketEndTime
        ? Math.max(0, Math.floor((state.marketEndTime.getTime() - now) / 1000))
        : state.countdown;

    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    DOM.countdown.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    if (remaining <= 30) {
        DOM.countdown.style.color = 'var(--down-color)';
    } else if (remaining <= 60) {
        DOM.countdown.style.color = '#f59e0b';
    } else {
        DOM.countdown.style.color = 'var(--accent)';
    }
}

function updateTradeSummary() {
    const amount = parseFloat(DOM.trade_amount.value) || 0;
    const price = state.currentSide === 'up' ? state.oddsUp : state.oddsDown;
    const shares = price > 0 ? amount / price : 0;
    const payout = shares;
    const profit = payout - amount;
    const profitPct = amount > 0 ? (profit / amount) * 100 : 0;

    DOM.shares_count.textContent = shares.toFixed(2);
    DOM.avg_price.textContent = `$${price.toFixed(2)}`;
    DOM.potential_payout.textContent = `$${payout.toFixed(2)}`;
    DOM.potential_profit.textContent = `+$${profit.toFixed(2)} (${profitPct.toFixed(0)}%)`;
}

function updateVolumeUI() {
    DOM.volume.textContent = `$${state.volume.toLocaleString()}`;
}

function updatePositionsUI() {
    if (state.positions.length === 0) {
        DOM.positions_section.style.display = 'none';
        return;
    }
    DOM.positions_section.style.display = 'block';
    DOM.positions_list.innerHTML = state.positions.map(pos => `
        <div class="position-item">
            <div>
                <span class="position-side ${pos.side}">${pos.side === 'up' ? '&#9650; UP' : '&#9660; DOWN'}</span>
            </div>
            <div class="position-details">
                <div class="position-shares">${pos.shares.toFixed(2)} shares</div>
                <div class="position-cost">Cost: $${pos.cost.toFixed(2)} @ $${pos.price.toFixed(2)}</div>
            </div>
        </div>
    `).join('');
}

function updateHistoryUI() {
    if (state.history.length === 0) {
        DOM.history_list.innerHTML = '<div class="history-empty">No trades yet. Place your first prediction!</div>';
        return;
    }
    DOM.history_list.innerHTML = state.history.slice(-20).reverse().map(trade => `
        <div class="history-item ${trade.won ? 'win' : 'loss'}">
            <div>
                <span class="history-side">${trade.side === 'up' ? '&#9650; UP' : '&#9660; DOWN'}</span>
                <span style="color:var(--text-muted); margin-left:8px; font-size:11px;">$${trade.cost.toFixed(0)}</span>
            </div>
            <span class="history-pnl">${trade.won ? '+' : ''}$${trade.pnl.toFixed(2)}</span>
        </div>
    `).join('');
}

function updateStatsUI() {
    DOM.stat_trades.textContent = state.totalTrades;
    DOM.stat_winrate.textContent = state.totalTrades > 0
        ? `${Math.round(state.wins / state.totalTrades * 100)}%` : '0%';
    DOM.stat_pnl.textContent = `${state.totalPnl >= 0 ? '+' : ''}$${state.totalPnl.toFixed(2)}`;
    DOM.stat_pnl.style.color = state.totalPnl >= 0 ? 'var(--up-color)' : 'var(--down-color)';
    DOM.stat_best.textContent = `+$${state.bestTrade.toFixed(2)}`;
}

function updateDataSourceUI(isLive, text) {
    const dot = DOM.data_source.querySelector('.source-dot');
    const label = DOM.data_source.querySelector('.source-text');
    dot.className = `source-dot ${isLive ? 'live' : 'sim'}`;
    label.textContent = text;
}

// ============ TRADING ============
function placeTrade() {
    const amount = parseFloat(DOM.trade_amount.value);
    if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');
    if (amount > state.balance) return showToast('Insufficient balance', 'error');
    if (!state.marketActive) return showToast('No active market', 'error');

    const side = state.currentSide;
    const price = side === 'up' ? state.oddsUp : state.oddsDown;
    const shares = amount / price;

    state.balance -= amount;
    state.positions.push({ side, shares, price, cost: amount, timestamp: Date.now() });
    state.volume += Math.round(amount);

    updateBalance();
    updateVolumeUI();
    updatePositionsUI();
    showToast(`Bought ${shares.toFixed(2)} ${side.toUpperCase()} @ $${price.toFixed(2)}`, 'success');
}

// ============ MODAL ============
function showResolutionModal(outcome, pnl, won) {
    DOM.modal_icon.innerHTML = won ? '&#127881;' : '&#128546;';
    DOM.modal_title.textContent = won ? 'You Won!' : 'Market Resolved';
    DOM.modal_result.textContent = `BTC went ${outcome.toUpperCase()} in this 5-minute window.`;

    const priceChange = (state.btcPrice || 0) - (state.btcStartPrice || 0);
    const pctChange = state.btcStartPrice ? (priceChange / state.btcStartPrice) * 100 : 0;

    DOM.modal_details.innerHTML = `
        <div class="detail-row">
            <span>Start Price</span>
            <span>$${(state.btcStartPrice || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
        </div>
        <div class="detail-row">
            <span>End Price</span>
            <span>$${(state.btcPrice || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
        </div>
        <div class="detail-row">
            <span>Change</span>
            <span style="color:${priceChange >= 0 ? 'var(--up-color)' : 'var(--down-color)'}">
                ${priceChange >= 0 ? '+' : ''}$${priceChange.toFixed(2)} (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(3)}%)
            </span>
        </div>
        <div class="detail-row">
            <span>Outcome</span>
            <span style="color:${outcome === 'up' ? 'var(--up-color)' : 'var(--down-color)'}; font-weight:700;">
                ${outcome === 'up' ? '&#9650; UP' : '&#9660; DOWN'}
            </span>
        </div>
        <div class="detail-row" style="border-top:1px solid var(--border); padding-top:8px; margin-top:4px;">
            <span>Your P&L</span>
            <span style="color:${pnl >= 0 ? 'var(--up-color)' : 'var(--down-color)'}; font-weight:700; font-size:16px;">
                ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}
            </span>
        </div>
    `;

    DOM.modal_overlay.style.display = 'flex';
}

// ============ UTILITIES ============
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    DOM.toast_container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ============ EVENT LISTENERS ============
function setupEvents() {
    DOM.tab_up.addEventListener('click', () => {
        state.currentSide = 'up';
        DOM.tab_up.classList.add('active');
        DOM.tab_down.classList.remove('active');
        DOM.place_trade_btn.className = 'trade-btn';
        DOM.place_trade_btn.innerHTML = 'Buy UP &#9650;';
        updateTradeSummary();
    });

    DOM.tab_down.addEventListener('click', () => {
        state.currentSide = 'down';
        DOM.tab_down.classList.add('active');
        DOM.tab_up.classList.remove('active');
        DOM.place_trade_btn.className = 'trade-btn down-active';
        DOM.place_trade_btn.innerHTML = 'Buy DOWN &#9660;';
        updateTradeSummary();
    });

    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            DOM.trade_amount.value = btn.dataset.amount;
            updateTradeSummary();
        });
    });

    DOM.trade_amount.addEventListener('input', updateTradeSummary);
    DOM.place_trade_btn.addEventListener('click', placeTrade);

    DOM.modal_close_btn.addEventListener('click', () => {
        DOM.modal_overlay.style.display = 'none';
        state.positions = [];
        updatePositionsUI();
        startMarketTracking();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && state.marketActive && DOM.modal_overlay.style.display === 'none') {
            placeTrade();
        }
    });
}

// ============ INIT ============
async function init() {
    initDOM();
    setupEvents();
    updateBalance();
    updateTradeSummary();
    updateHistoryUI();
    updateStatsUI();

    // Start tracking live market
    await startMarketTracking();
}

document.addEventListener('DOMContentLoaded', init);
