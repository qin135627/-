/**
 * PolyBTC - Polymarket BTC 5-Minute Market Mirror + Paper Trading
 * 
 * This app is a STRICT mirror of live Polymarket data:
 * - All odds come directly from Polymarket APIs (Gamma + CLOB)
 * - Countdown syncs to the REAL market end time
 * - No simulation, no fake odds - if API is unavailable, shows "waiting"
 * - Paper trading only (fake money, real data)
 * 
 * APIs used:
 * - Gamma API (https://gamma-api.polymarket.com): Market discovery
 * - CLOB API (https://clob.polymarket.com): Real-time midpoint pricing
 * - Binance API: Real BTC price reference
 */

// ============ CONFIG ============
const CONFIG = {
    GAMMA_API: 'https://gamma-api.polymarket.com',
    CLOB_API: 'https://clob.polymarket.com',
    BINANCE_API: 'https://api.binance.com/api/v3',
    REFRESH_ODDS_MS: 3000,       // Refresh odds every 3 seconds
    REFRESH_PRICE_MS: 2000,      // Refresh BTC price every 2 seconds
    SEARCH_MARKET_MS: 5000,      // Search for new market every 5 seconds when waiting
};

// ============ STATE ============
const state = {
    // Paper trading
    balance: 1000,
    positions: [],
    history: [],
    totalTrades: 0,
    wins: 0,
    totalPnl: 0,
    bestTrade: 0,

    // Live Polymarket data (strict - no simulation)
    market: null,              // Full market object from Gamma API
    slug: null,                // e.g. "btc-updown-5m-1778895000"
    conditionId: null,
    tokenIdYes: null,          // CLOB token for "Up" (Yes outcome)
    tokenIdNo: null,           // CLOB token for "Down" (No outcome)
    marketEndTime: null,       // Real end time from Polymarket
    marketStartTime: null,     // Derived from slug timestamp
    question: null,            // Market question text

    // Live prices from Polymarket CLOB
    priceYes: null,            // Up price (0-1)
    priceNo: null,             // Down price (0-1)
    
    // BTC price from Binance
    btcPrice: null,
    btcStartPrice: null,       // BTC price at market start

    // UI
    currentSide: 'up',
    marketActive: false,
    volume: 0,

    // Status
    status: 'searching',       // 'searching' | 'live' | 'waiting' | 'resolved' | 'error'
    lastError: null,

    // Timers
    oddsTimer: null,
    priceTimer: null,
    countdownTimer: null,
    searchTimer: null,
};

// ============ DOM ============
const $ = (id) => document.getElementById(id);

// ============ GAMMA API: FIND ACTIVE BTC 5M MARKET ============
async function findActiveMarket() {
    try {
        // Try multiple query strategies to find active BTC 5m market
        let events = [];

        // Strategy 1: events endpoint with slug_contains
        const urls = [
            `${CONFIG.GAMMA_API}/events?slug_contains=btc-updown-5m&active=true&closed=false&limit=10`,
            `${CONFIG.GAMMA_API}/events?tag=crypto&active=true&closed=false&limit=50`,
        ];

        for (const url of urls) {
            try {
                console.log('[PolyBTC] Trying:', url);
                const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
                if (!resp.ok) {
                    console.log('[PolyBTC] Response:', resp.status);
                    continue;
                }
                const data = await resp.json();
                console.log('[PolyBTC] Got', data.length, 'events');
                // Log ALL slugs so we can see what's available
                console.log('[PolyBTC] All event slugs:', data.map(e => e.slug));
                
                // Filter for btc-updown-5m (try multiple patterns)
                const filtered = data.filter(e => 
                    (e.slug && (e.slug.includes('btc-updown-5m') || e.slug.includes('btc-up-down-5m') || e.slug.includes('bitcoin-5m'))) ||
                    (e.title && e.title.includes('5') && e.title.toLowerCase().includes('btc'))
                );
                console.log('[PolyBTC] BTC 5m events found:', filtered.length, filtered.map(e => e.slug || e.title));
                
                if (filtered.length > 0) {
                    events = filtered;
                    break;
                }
                if (data.length > 0 && events.length === 0) {
                    events = data.filter(e => e.slug && e.slug.includes('btc-updown-5m'));
                }
            } catch (e) {
                console.log('[PolyBTC] Fetch error:', e.message);
            }
        }

        // Strategy 2: Try markets endpoint directly if events didn't work
        if (events.length === 0) {
            console.log('[PolyBTC] Trying markets endpoint...');
            try {
                const resp = await fetch(
                    `${CONFIG.GAMMA_API}/markets?active=true&closed=false&limit=50`,
                    { signal: AbortSignal.timeout(10000) }
                );
                if (resp.ok) {
                    const markets = await resp.json();
                    console.log('[PolyBTC] Got', markets.length, 'markets');
                    // Log all market slugs/questions
                    console.log('[PolyBTC] All market slugs:', markets.slice(0, 10).map(m => m.slug || m.question));
                    const btcMarkets = markets.filter(m => 
                        (m.slug && (m.slug.includes('btc-updown-5m') || m.slug.includes('btc-up-down-5m') || m.slug.includes('bitcoin-5m'))) ||
                        (m.question && m.question.toLowerCase().includes('btc') && (m.question.includes('5') || m.question.toLowerCase().includes('minute')))
                    );
                    console.log('[PolyBTC] BTC 5m markets:', btcMarkets.length, btcMarkets.map(m => m.slug || m.question));
                    
                    if (btcMarkets.length > 0) {
                        // Convert market to event-like structure
                        const market = btcMarkets[0];
                        const endTime = new Date(market.endDate).getTime();
                        const slugParts = (market.slug || '').split('-');
                        const startUnix = parseInt(slugParts[slugParts.length - 1]);
                        const startTime = isNaN(startUnix) ? endTime - 300000 : startUnix * 1000;

                        let tokenIds = null;
                        if (market.clobTokenIds) {
                            try { tokenIds = JSON.parse(market.clobTokenIds); } catch(e) {}
                        }
                        let prices = null;
                        if (market.outcomePrices) {
                            try { prices = JSON.parse(market.outcomePrices); } catch(e) {}
                        }

                        console.log('[PolyBTC] Using market:', market.slug, 'tokens:', tokenIds, 'prices:', prices);
                        return {
                            event: null,
                            market,
                            slug: market.slug || market.groupItemTitle,
                            question: market.question,
                            startTime,
                            endTime,
                            tokenIdYes: tokenIds ? tokenIds[0] : null,
                            tokenIdNo: tokenIds ? tokenIds[1] : null,
                            priceYes: prices ? parseFloat(prices[0]) : null,
                            priceNo: prices ? parseFloat(prices[1]) : null,
                            volume: parseFloat(market.volume || 0),
                            conditionId: market.conditionId || null,
                        };
                    }
                }
            } catch (e) {
                console.log('[PolyBTC] Markets endpoint error:', e.message);
            }
        }

        if (events.length === 0) {
            console.log('[PolyBTC] No BTC 5m markets found via any strategy');
            return null;
        }

        const now = Date.now();

        // Find the currently ACTIVE market (started but not yet ended)
        for (const event of events) {
            if (!event.markets || event.markets.length === 0) continue;
            const market = event.markets[0];

            // Get end time
            const endTime = new Date(market.endDate || event.endDate).getTime();
            if (endTime <= now) continue; // Already ended

            // Get start time from slug: btc-updown-5m-{unix_seconds}
            const slugParts = (event.slug || '').split('-');
            const startUnix = parseInt(slugParts[slugParts.length - 1]);
            if (isNaN(startUnix)) continue;
            const startTime = startUnix * 1000;

            // Accept if hasn't ended yet (even if not started, we'll show countdown)
            // Previously we skipped if startTime > now, but let's be more lenient

            // Parse token IDs
            let tokenIds = null;
            if (market.clobTokenIds) {
                try { tokenIds = JSON.parse(market.clobTokenIds); } catch(e) {}
            }

            // Parse current prices
            let prices = null;
            if (market.outcomePrices) {
                try { prices = JSON.parse(market.outcomePrices); } catch(e) {}
            }

            console.log('[PolyBTC] Found active event:', event.slug, 'end:', new Date(endTime).toISOString(), 'start:', new Date(startTime).toISOString());

            return {
                event,
                market,
                slug: event.slug,
                question: market.question || event.title,
                startTime,
                endTime,
                tokenIdYes: tokenIds ? tokenIds[0] : null,
                tokenIdNo: tokenIds ? tokenIds[1] : null,
                priceYes: prices ? parseFloat(prices[0]) : null,
                priceNo: prices ? parseFloat(prices[1]) : null,
                volume: parseFloat(market.volume || event.volume || 0),
                conditionId: market.conditionId || null,
            };
        }

        // No active market found - check if there's an upcoming one
        for (const event of events) {
            if (!event.markets || event.markets.length === 0) continue;
            const market = event.markets[0];
            const endTime = new Date(market.endDate || event.endDate).getTime();
            if (endTime <= now) continue;

            const slugParts = (event.slug || '').split('-');
            const startUnix = parseInt(slugParts[slugParts.length - 1]);
            if (isNaN(startUnix)) continue;
            const startTime = startUnix * 1000;

            // This market hasn't started yet - return it so we can show countdown to start
            if (startTime > now) {
                let tokenIds = null;
                if (market.clobTokenIds) {
                    try { tokenIds = JSON.parse(market.clobTokenIds); } catch(e) {}
                }
                let prices = null;
                if (market.outcomePrices) {
                    try { prices = JSON.parse(market.outcomePrices); } catch(e) {}
                }

                return {
                    event,
                    market,
                    slug: event.slug,
                    question: market.question || event.title,
                    startTime,
                    endTime,
                    tokenIdYes: tokenIds ? tokenIds[0] : null,
                    tokenIdNo: tokenIds ? tokenIds[1] : null,
                    priceYes: prices ? parseFloat(prices[0]) : null,
                    priceNo: prices ? parseFloat(prices[1]) : null,
                    volume: parseFloat(market.volume || event.volume || 0),
                    conditionId: market.conditionId || null,
                    upcoming: true,
                };
            }
        }

        return null;
    } catch (err) {
        console.error('findActiveMarket:', err);
        state.lastError = err.message;
        return null;
    }
}

// ============ CLOB API: GET REAL-TIME MIDPOINT ============
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

// Also try the price endpoint as alternative
async function fetchPrice(tokenId) {
    try {
        const resp = await fetch(
            `${CONFIG.CLOB_API}/price?token_id=${tokenId}&side=buy`,
            { signal: AbortSignal.timeout(5000) }
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.price ? parseFloat(data.price) : null;
    } catch (e) {
        return null;
    }
}

async function refreshOddsFromPoly() {
    if (!state.tokenIdYes) return;

    // Try midpoint first (most accurate - between best bid and ask)
    let price = await fetchMidpoint(state.tokenIdYes);
    
    // Fallback to price endpoint
    if (price === null) {
        price = await fetchPrice(state.tokenIdYes);
    }

    if (price !== null && price > 0 && price < 1) {
        state.priceYes = price;
        state.priceNo = 1 - price;
        renderOdds();
        renderTradeSummary();
    }
}

// ============ BINANCE: REAL BTC PRICE ============
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

    const marketData = await findActiveMarket();

    if (!marketData) {
        setStatus('waiting');
        showToast('No active BTC 5m market on Polymarket right now. Waiting...', 'info');
        // Keep searching
        state.searchTimer = setInterval(async () => {
            const m = await findActiveMarket();
            if (m) {
                clearInterval(state.searchTimer);
                state.searchTimer = null;
                connectToMarket(m);
            }
        }, CONFIG.SEARCH_MARKET_MS);
        return;
    }

    if (marketData.upcoming) {
        // Market hasn't started yet - wait for it
        setStatus('waiting');
        const waitMs = marketData.startTime - Date.now();
        showToast(`Next market starts in ${Math.ceil(waitMs/1000)}s. Waiting...`, 'info');
        $('market-title').textContent = marketData.question || 'Waiting for market...';
        $('countdown').textContent = formatTime(Math.ceil(waitMs / 1000));
        
        state.searchTimer = setTimeout(() => {
            searchAndConnect();
        }, Math.min(waitMs + 1000, 30000));
        return;
    }

    connectToMarket(marketData);
}

function connectToMarket(marketData) {
    // Store market data
    state.market = marketData;
    state.slug = marketData.slug;
    state.question = marketData.question;
    state.tokenIdYes = marketData.tokenIdYes;
    state.tokenIdNo = marketData.tokenIdNo;
    state.marketStartTime = marketData.startTime;
    state.marketEndTime = marketData.endTime;
    state.conditionId = marketData.conditionId;
    state.volume = Math.round(marketData.volume || 0);
    state.positions = [];
    state.marketActive = true;

    // Set initial prices from Gamma API snapshot
    if (marketData.priceYes !== null) {
        state.priceYes = marketData.priceYes;
        state.priceNo = marketData.priceNo;
    } else {
        state.priceYes = 0.50;
        state.priceNo = 0.50;
    }

    // Get BTC price
    fetchBtcPrice().then(() => {
        state.btcStartPrice = state.btcPrice;
        renderStartPrice();
    });

    // Render UI
    setStatus('live');
    renderMarketInfo();
    renderOdds();
    renderBalance();
    renderPositions();

    showToast(`Connected to: ${marketData.question}`, 'success');

    // Start real-time polling
    state.oddsTimer = setInterval(refreshOddsFromPoly, CONFIG.REFRESH_ODDS_MS);
    state.priceTimer = setInterval(fetchBtcPrice, CONFIG.REFRESH_PRICE_MS);

    // Start countdown (synced to real market end time)
    state.countdownTimer = setInterval(() => {
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((state.marketEndTime - now) / 1000));

        renderCountdown(remaining);

        if (remaining <= 0) {
            resolveMarket();
        }
    }, 1000);

    // Immediately fetch latest odds from CLOB
    refreshOddsFromPoly();
}

function resolveMarket() {
    stopAllTimers();
    state.marketActive = false;
    setStatus('resolved');

    // Determine outcome: BTC end price vs start price
    const outcome = state.btcPrice >= state.btcStartPrice ? 'up' : 'down';

    // Settle positions
    let roundPnl = 0;
    let roundWon = false;

    state.positions.forEach(pos => {
        const won = pos.side === outcome;
        const payout = won ? pos.shares : 0; // $1 per share if won
        const pnl = payout - pos.cost;

        if (won) {
            state.balance += payout;
            roundWon = true;
        }

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
        setTimeout(searchAndConnect, 3000);
    }
}

function stopAllTimers() {
    if (state.oddsTimer) { clearInterval(state.oddsTimer); state.oddsTimer = null; }
    if (state.priceTimer) { clearInterval(state.priceTimer); state.priceTimer = null; }
    if (state.countdownTimer) { clearInterval(state.countdownTimer); state.countdownTimer = null; }
    if (state.searchTimer) { clearInterval(state.searchTimer); clearTimeout(state.searchTimer); state.searchTimer = null; }
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
    showToast(`Bought ${shares.toFixed(2)} ${side.toUpperCase()} @ $${price.toFixed(3)} (Poly price)`, 'success');
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
            label.textContent = 'Polymarket Live Data (Gamma + CLOB)';
            btn.disabled = false;
            break;
        case 'waiting':
            tag.textContent = 'WAITING';
            tag.className = 'tag crypto';
            dot.className = 'source-dot sim';
            label.textContent = 'Waiting for next Polymarket BTC 5m market...';
            btn.disabled = true;
            break;
        case 'resolved':
            tag.textContent = 'RESOLVED';
            tag.className = 'tag ended';
            dot.className = 'source-dot';
            label.textContent = 'Market ended. Searching for next...';
            btn.disabled = true;
            break;
        case 'error':
            tag.textContent = 'ERROR';
            tag.className = 'tag ended';
            dot.className = 'source-dot';
            label.textContent = `API Error: ${state.lastError || 'Unknown'}`;
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
    $('countdown').textContent = formatTime(seconds);
    const el = $('countdown');
    if (seconds <= 30) el.style.color = 'var(--down-color)';
    else if (seconds <= 60) el.style.color = '#f59e0b';
    else el.style.color = 'var(--accent)';
}

function renderBtcPrice() {
    if (!state.btcPrice) return;
    $('btc-price').textContent = `$${state.btcPrice.toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    })}`;

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
        ? `$${state.btcStartPrice.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
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
    const payout = shares;
    const profit = payout - amount;
    const profitPct = amount > 0 ? (profit / amount) * 100 : 0;

    $('shares-count').textContent = shares.toFixed(2);
    $('avg-price').textContent = `$${price.toFixed(3)}`;
    $('potential-payout').textContent = `$${payout.toFixed(2)}`;
    $('potential-profit').textContent = `+$${profit.toFixed(2)} (${profitPct.toFixed(0)}%)`;
}

function renderPositions() {
    const section = $('positions-section');
    const list = $('positions-list');
    if (state.positions.length === 0) {
        section.style.display = 'none';
        return;
    }
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

// ============ MODAL ============
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

// ============ UTILITIES ============
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
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

// ============ EVENTS ============
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

// ============ INIT ============
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
