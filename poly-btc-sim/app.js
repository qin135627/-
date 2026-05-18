/**
 * PolyBTC Sim - Polymarket-style BTC 5-minute prediction simulator
 * 
 * Features:
 * - Attempts to fetch real odds from Polymarket's public API (gamma-api)
 * - Falls back to simulated odds based on real market behavior
 * - Fetches real BTC price from CoinGecko / Binance API
 * - Full trading simulation with position tracking and P&L
 */

// ============ STATE ============
const state = {
    balance: 1000,
    positions: [],       // Active positions for current round
    history: [],         // All completed trades
    totalTrades: 0,
    wins: 0,
    totalPnl: 0,
    bestTrade: 0,
    
    // Market state
    marketActive: false,
    currentSide: 'up',   // Selected trade side
    oddsUp: 0.50,        // Probability/price for Up
    oddsDown: 0.50,
    startPrice: null,     // BTC price at round start
    currentPrice: null,   // Live BTC price
    countdown: 300,       // 5 minutes in seconds
    countdownInterval: null,
    priceInterval: null,
    volume: 0,
    
    // Data source
    useRealData: false,
    polymarketConnected: false,
    btcPriceSource: 'simulated',
};

// ============ DOM ELEMENTS ============
const DOM = {
    balance: document.getElementById('balance'),
    btcPrice: document.getElementById('btc-price'),
    btcChange: document.getElementById('btc-change'),
    startPrice: document.getElementById('start-price'),
    countdown: document.getElementById('countdown'),
    volume: document.getElementById('volume'),
    oddsUp: document.getElementById('odds-up'),
    oddsDown: document.getElementById('odds-down'),
    priceUp: document.getElementById('price-up'),
    priceDown: document.getElementById('price-down'),
    oddsBarUp: document.getElementById('odds-bar-up'),
    oddsBarDown: document.getElementById('odds-bar-down'),
    tradeAmount: document.getElementById('trade-amount'),
    sharesCount: document.getElementById('shares-count'),
    avgPrice: document.getElementById('avg-price'),
    potentialPayout: document.getElementById('potential-payout'),
    potentialProfit: document.getElementById('potential-profit'),
    tradeBtn: document.getElementById('place-trade-btn'),
    tabUp: document.getElementById('tab-up'),
    tabDown: document.getElementById('tab-down'),
    positionsSection: document.getElementById('positions-section'),
    positionsList: document.getElementById('positions-list'),
    historyList: document.getElementById('history-list'),
    toastContainer: document.getElementById('toast-container'),
    modalOverlay: document.getElementById('modal-overlay'),
    modalIcon: document.getElementById('modal-icon'),
    modalTitle: document.getElementById('modal-title'),
    modalResult: document.getElementById('modal-result'),
    modalDetails: document.getElementById('modal-details'),
    modalCloseBtn: document.getElementById('modal-close-btn'),
    dataSource: document.getElementById('data-source'),
    marketTitle: document.getElementById('market-title'),
    marketStatusTag: document.getElementById('market-status-tag'),
    statTrades: document.getElementById('stat-trades'),
    statWinrate: document.getElementById('stat-winrate'),
    statPnl: document.getElementById('stat-pnl'),
    statBest: document.getElementById('stat-best'),
};

// ============ POLYMARKET API ============
// Official Polymarket API endpoints:
// - Gamma API: markets, events, tags, search, public profiles
// - CLOB API: orderbook, pricing, midpoints, spreads, price history
// - Data API: user positions, trades, open interest, leaderboards
const POLYMARKET_API = {
    gamma: 'https://gamma-api.polymarket.com',
    clob: 'https://clob.polymarket.com',
    data: 'https://data-api.polymarket.com',
};

// Store found market token IDs for CLOB price queries
let cachedTokenId = null;

// Try to fetch real Polymarket odds for BTC 5m market
async function fetchPolymarketOdds() {
    try {
        // Step 1: Use Gamma API to find active BTC 5-minute market event
        const response = await fetch(
            `${POLYMARKET_API.gamma}/events?tag=crypto&active=true&closed=false&limit=30`,
            { signal: AbortSignal.timeout(5000) }
        );
        
        if (!response.ok) throw new Error('Gamma API unavailable');
        
        const events = await response.json();
        
        // Find BTC 5-minute up/down market
        const btcEvent = events.find(e => 
            e.slug && e.slug.includes('btc-updown-5m')
        );
        
        if (btcEvent && btcEvent.markets && btcEvent.markets.length > 0) {
            const market = btcEvent.markets[0];
            
            // outcomePrices from Gamma API (array of [yesPrice, noPrice])
            if (market.outcomePrices) {
                const prices = JSON.parse(market.outcomePrices);
                state.oddsUp = parseFloat(prices[0]);
                state.oddsDown = parseFloat(prices[1]);
                state.polymarketConnected = true;
                state.useRealData = true;
                
                // Cache token ID for CLOB midpoint queries
                if (market.clobTokenIds) {
                    const tokenIds = JSON.parse(market.clobTokenIds);
                    cachedTokenId = tokenIds[0]; // YES token
                }
                
                updateDataSource(true, 'Polymarket Gamma API (Live)');
                return true;
            }
        }
        
        // Step 2: Fallback - try CLOB API midpoint if we have a token ID
        if (cachedTokenId) {
            return await fetchClobMidpoint(cachedTokenId);
        }
        
        // Step 3: Try searching Gamma API by slug directly
        const slugResp = await fetch(
            `${POLYMARKET_API.gamma}/markets?slug_contains=btc-updown-5m&active=true&closed=false&limit=5`,
            { signal: AbortSignal.timeout(5000) }
        );
        
        if (slugResp.ok) {
            const markets = await slugResp.json();
            if (markets.length > 0) {
                const market = markets[0];
                if (market.outcomePrices) {
                    const prices = JSON.parse(market.outcomePrices);
                    state.oddsUp = parseFloat(prices[0]);
                    state.oddsDown = parseFloat(prices[1]);
                    state.polymarketConnected = true;
                    state.useRealData = true;
                    
                    if (market.clobTokenIds) {
                        const tokenIds = JSON.parse(market.clobTokenIds);
                        cachedTokenId = tokenIds[0];
                    }
                    
                    updateDataSource(true, 'Polymarket Gamma API (Live)');
                    return true;
                }
            }
        }
        
        return false;
    } catch (err) {
        console.log('Polymarket API not available, using simulation:', err.message);
        return false;
    }
}

// Fetch midpoint price from CLOB API (public, no auth needed)
async function fetchClobMidpoint(tokenId) {
    try {
        const resp = await fetch(
            `${POLYMARKET_API.clob}/midpoint?token_id=${tokenId}`,
            { signal: AbortSignal.timeout(3000) }
        );
        if (resp.ok) {
            const data = await resp.json();
            if (data.mid) {
                state.oddsUp = parseFloat(data.mid);
                state.oddsDown = 1 - state.oddsUp;
                state.polymarketConnected = true;
                state.useRealData = true;
                updateDataSource(true, 'Polymarket CLOB (Midpoint)');
                return true;
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

// Refresh odds from CLOB during active round (for real-time updates)
async function refreshLiveOdds() {
    if (!state.polymarketConnected || !cachedTokenId) return;
    
    try {
        const resp = await fetch(
            `${POLYMARKET_API.clob}/midpoint?token_id=${cachedTokenId}`,
            { signal: AbortSignal.timeout(3000) }
        );
        if (resp.ok) {
            const data = await resp.json();
            if (data.mid) {
                state.oddsUp = parseFloat(data.mid);
                state.oddsDown = 1 - state.oddsUp;
            }
        }
    } catch (e) {
        // Silently fail, keep last known odds
    }
}

// ============ BTC PRICE ============
let simulatedBtcBase = 103500 + (Math.random() - 0.5) * 2000;

async function fetchBtcPrice() {
    try {
        // Try Binance API first
        const resp = await fetch(
            'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
            { signal: AbortSignal.timeout(3000) }
        );
        if (resp.ok) {
            const data = await resp.json();
            state.currentPrice = parseFloat(data.price);
            state.btcPriceSource = 'binance';
            return;
        }
    } catch (e) {}
    
    try {
        // Try CoinGecko
        const resp = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
            { signal: AbortSignal.timeout(3000) }
        );
        if (resp.ok) {
            const data = await resp.json();
            state.currentPrice = data.bitcoin.usd;
            state.btcPriceSource = 'coingecko';
            return;
        }
    } catch (e) {}
    
    // Fallback: simulate BTC price movement (realistic volatility)
    simulateBtcPrice();
    state.btcPriceSource = 'simulated';
}

function simulateBtcPrice() {
    // BTC 5-min volatility ~0.1-0.3%
    const volatility = 0.001;
    const drift = (Math.random() - 0.498) * volatility; // slight upward bias
    simulatedBtcBase *= (1 + drift);
    // Add small random noise
    const noise = (Math.random() - 0.5) * 20;
    state.currentPrice = Math.round((simulatedBtcBase + noise) * 100) / 100;
}

// ============ ODDS SIMULATION ============
function simulatePolymarketOdds() {
    // Realistic odds simulation based on Polymarket BTC 5m markets
    // Typically ranges from 45-55% for Up, centered slightly above 50%
    // Add time-based drift and momentum
    
    const baseOdds = 0.50;
    
    // Momentum: if price is trending up/down, odds shift
    let momentum = 0;
    if (state.startPrice && state.currentPrice) {
        const pctChange = (state.currentPrice - state.startPrice) / state.startPrice;
        momentum = pctChange * 10; // amplify for odds impact
    }
    
    // Random walk component
    const randomShift = (Math.random() - 0.5) * 0.03;
    
    // Time decay: as time runs out, odds become more extreme if there's a clear direction
    const timeLeft = state.countdown / 300;
    const timeWeight = 1 - timeLeft * 0.5;
    
    let newOddsUp = baseOdds + momentum * timeWeight + randomShift;
    
    // Clamp between 0.15 and 0.85
    newOddsUp = Math.max(0.15, Math.min(0.85, newOddsUp));
    
    // Smooth transition
    state.oddsUp = state.oddsUp * 0.7 + newOddsUp * 0.3;
    state.oddsDown = 1 - state.oddsUp;
}

// ============ UI UPDATES ============
function updateBalance() {
    DOM.balance.textContent = `$${state.balance.toFixed(2)}`;
    DOM.balance.style.color = state.balance >= 1000 ? 'var(--up-color)' : 
                              state.balance >= 500 ? 'var(--text-primary)' : 'var(--down-color)';
}

function updateBtcPrice() {
    if (!state.currentPrice) return;
    
    DOM.btcPrice.textContent = `$${state.currentPrice.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
    
    if (state.startPrice) {
        const change = state.currentPrice - state.startPrice;
        const pct = (change / state.startPrice) * 100;
        const sign = change >= 0 ? '+' : '';
        DOM.btcChange.textContent = `${sign}$${change.toFixed(2)} (${sign}${pct.toFixed(3)}%)`;
        DOM.btcChange.className = `price-change ${change >= 0 ? 'up' : 'down'}`;
    }
}

function updateOdds() {
    const upPct = Math.round(state.oddsUp * 100);
    const downPct = 100 - upPct;
    
    DOM.oddsUp.textContent = `${upPct}%`;
    DOM.oddsDown.textContent = `${downPct}%`;
    DOM.priceUp.textContent = `$${state.oddsUp.toFixed(2)}`;
    DOM.priceDown.textContent = `$${state.oddsDown.toFixed(2)}`;
    DOM.oddsBarUp.style.width = `${upPct}%`;
    DOM.oddsBarDown.style.width = `${downPct}%`;
    
    updateTradeSummary();
}

function updateCountdown() {
    const minutes = Math.floor(state.countdown / 60);
    const seconds = state.countdown % 60;
    DOM.countdown.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    if (state.countdown <= 30) {
        DOM.countdown.style.color = 'var(--down-color)';
    } else if (state.countdown <= 60) {
        DOM.countdown.style.color = '#f59e0b';
    } else {
        DOM.countdown.style.color = 'var(--accent)';
    }
}

function updateTradeSummary() {
    const amount = parseFloat(DOM.tradeAmount.value) || 0;
    const price = state.currentSide === 'up' ? state.oddsUp : state.oddsDown;
    const shares = amount / price;
    const payout = shares; // Each share pays $1 if correct
    const profit = payout - amount;
    const profitPct = amount > 0 ? (profit / amount) * 100 : 0;
    
    DOM.sharesCount.textContent = shares.toFixed(2);
    DOM.avgPrice.textContent = `$${price.toFixed(2)}`;
    DOM.potentialPayout.textContent = `$${payout.toFixed(2)}`;
    DOM.potentialProfit.textContent = `+$${profit.toFixed(2)} (${profitPct.toFixed(0)}%)`;
}

function updateVolume() {
    DOM.volume.textContent = `$${state.volume.toLocaleString()}`;
}

function updatePositions() {
    if (state.positions.length === 0) {
        DOM.positionsSection.style.display = 'none';
        return;
    }
    
    DOM.positionsSection.style.display = 'block';
    DOM.positionsList.innerHTML = state.positions.map(pos => `
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

function updateHistory() {
    if (state.history.length === 0) {
        DOM.historyList.innerHTML = '<div class="history-empty">No trades yet. Place your first prediction!</div>';
        return;
    }
    
    DOM.historyList.innerHTML = state.history.slice(-20).reverse().map(trade => `
        <div class="history-item ${trade.won ? 'win' : 'loss'}">
            <div>
                <span class="history-side">${trade.side === 'up' ? '&#9650; UP' : '&#9660; DOWN'}</span>
                <span style="color:var(--text-muted); margin-left:8px; font-size:11px;">$${trade.cost.toFixed(0)}</span>
            </div>
            <span class="history-pnl">${trade.won ? '+' : ''}$${trade.pnl.toFixed(2)}</span>
        </div>
    `).join('');
}

function updateStats() {
    DOM.statTrades.textContent = state.totalTrades;
    DOM.statWinrate.textContent = state.totalTrades > 0 
        ? `${Math.round(state.wins / state.totalTrades * 100)}%` 
        : '0%';
    DOM.statPnl.textContent = `${state.totalPnl >= 0 ? '+' : ''}$${state.totalPnl.toFixed(2)}`;
    DOM.statPnl.style.color = state.totalPnl >= 0 ? 'var(--up-color)' : 'var(--down-color)';
    DOM.statBest.textContent = `+$${state.bestTrade.toFixed(2)}`;
    DOM.statBest.style.color = 'var(--up-color)';
}

function updateDataSource(isLive, text) {
    const dot = DOM.dataSource.querySelector('.source-dot');
    const label = DOM.dataSource.querySelector('.source-text');
    dot.className = `source-dot ${isLive ? 'live' : 'sim'}`;
    label.textContent = text;
}

// ============ TRADING LOGIC ============
function placeTrade() {
    const amount = parseFloat(DOM.tradeAmount.value);
    
    if (!amount || amount <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }
    
    if (amount > state.balance) {
        showToast('Insufficient balance', 'error');
        return;
    }
    
    if (!state.marketActive) {
        showToast('Market is not active. Wait for next round.', 'error');
        return;
    }
    
    const side = state.currentSide;
    const price = side === 'up' ? state.oddsUp : state.oddsDown;
    const shares = amount / price;
    
    // Deduct from balance
    state.balance -= amount;
    updateBalance();
    
    // Add position
    state.positions.push({
        side,
        shares,
        price,
        cost: amount,
        timestamp: Date.now()
    });
    
    // Update volume
    state.volume += Math.round(amount);
    updateVolume();
    updatePositions();
    
    showToast(`Bought ${shares.toFixed(2)} ${side.toUpperCase()} shares @ $${price.toFixed(2)}`, 'success');
    
    // Simulate market impact (small odds shift)
    if (side === 'up') {
        state.oddsUp = Math.min(0.85, state.oddsUp + 0.005);
    } else {
        state.oddsDown = Math.min(0.85, state.oddsDown + 0.005);
    }
    state.oddsDown = 1 - state.oddsUp;
    updateOdds();
}

// ============ MARKET ROUNDS ============
async function startNewRound() {
    // Reset round state
    state.positions = [];
    state.countdown = 300;
    state.volume = Math.round(Math.random() * 5000 + 2000); // Simulated base volume
    state.marketActive = true;
    
    // Get BTC price
    await fetchBtcPrice();
    state.startPrice = state.currentPrice;
    DOM.startPrice.textContent = `$${state.startPrice.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
    
    // Try to get real Polymarket odds
    const gotRealOdds = await fetchPolymarketOdds();
    if (!gotRealOdds) {
        // Start with slightly randomized odds (like real market)
        state.oddsUp = 0.48 + Math.random() * 0.06; // 48-54%
        state.oddsDown = 1 - state.oddsUp;
        updateDataSource(false, 'Simulated Odds (Polymarket-style)');
    }
    
    // Update UI
    updateOdds();
    updateBtcPrice();
    updateCountdown();
    updateVolume();
    updatePositions();
    
    // Update market status
    DOM.marketStatusTag.textContent = 'LIVE';
    DOM.marketStatusTag.className = 'tag live';
    DOM.tradeBtn.disabled = false;
    
    // Generate timestamp for market title
    const now = new Date();
    const endTime = new Date(now.getTime() + 300000);
    const fmt = (d) => `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
    DOM.marketTitle.textContent = `BTC Up or Down - 5 Min (${fmt(now)} - ${fmt(endTime)})`;
    
    // Start countdown
    state.countdownInterval = setInterval(tickCountdown, 1000);
    
    // Start price updates
    state.priceInterval = setInterval(async () => {
        await fetchBtcPrice();
        updateBtcPrice();
        if (state.useRealData) {
            // Refresh live odds from CLOB API midpoint
            await refreshLiveOdds();
        } else {
            simulatePolymarketOdds();
        }
        updateOdds();
    }, 3000); // Update every 3 seconds
    
    showToast('New round started! Place your prediction.', 'info');
}

function tickCountdown() {
    state.countdown--;
    updateCountdown();
    
    if (state.countdown <= 0) {
        resolveMarket();
    }
    
    // Warning at 30 seconds
    if (state.countdown === 30) {
        showToast('30 seconds remaining!', 'info');
    }
}

function resolveMarket() {
    // Stop timers
    clearInterval(state.countdownInterval);
    clearInterval(state.priceInterval);
    state.marketActive = false;
    
    // Determine outcome
    const outcome = state.currentPrice >= state.startPrice ? 'up' : 'down';
    
    // Update market status
    DOM.marketStatusTag.textContent = 'ENDED';
    DOM.marketStatusTag.className = 'tag ended';
    DOM.tradeBtn.disabled = true;
    
    // Calculate P&L for each position
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
        
        // Add to history
        state.history.push({
            side: pos.side,
            cost: pos.cost,
            shares: pos.shares,
            price: pos.price,
            pnl,
            won,
            outcome,
            timestamp: Date.now()
        });
        
        state.totalTrades++;
        if (won) state.wins++;
        state.totalPnl += pnl;
        if (pnl > state.bestTrade) state.bestTrade = pnl;
    });
    
    updateBalance();
    updateHistory();
    updateStats();
    
    // Show resolution modal
    if (state.positions.length > 0) {
        showResolutionModal(outcome, roundPnl, roundWon);
    } else {
        // No positions, auto-start next round after delay
        showToast(`Market resolved: ${outcome.toUpperCase()}. No positions.`, 'info');
        setTimeout(startNewRound, 3000);
    }
}

function showResolutionModal(outcome, pnl, won) {
    DOM.modalIcon.textContent = won ? '&#127881;' : '&#128546;';
    DOM.modalTitle.textContent = won ? 'You Won!' : 'Market Resolved';
    DOM.modalResult.textContent = `BTC went ${outcome.toUpperCase()} in this 5-minute window.`;
    
    const priceChange = state.currentPrice - state.startPrice;
    const pctChange = (priceChange / state.startPrice) * 100;
    
    DOM.modalDetails.innerHTML = `
        <div class="detail-row">
            <span>Start Price</span>
            <span>$${state.startPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
        </div>
        <div class="detail-row">
            <span>End Price</span>
            <span>$${state.currentPrice.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
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
    
    DOM.modalOverlay.style.display = 'flex';
}

// ============ UTILITIES ============
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    DOM.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
    // Trade side tabs
    DOM.tabUp.addEventListener('click', () => {
        state.currentSide = 'up';
        DOM.tabUp.classList.add('active');
        DOM.tabDown.classList.remove('active');
        DOM.tradeBtn.className = 'trade-btn';
        DOM.tradeBtn.textContent = 'Buy UP &#9650;';
        updateTradeSummary();
    });
    
    DOM.tabDown.addEventListener('click', () => {
        state.currentSide = 'down';
        DOM.tabDown.classList.add('active');
        DOM.tabUp.classList.remove('active');
        DOM.tradeBtn.className = 'trade-btn down-active';
        DOM.tradeBtn.textContent = 'Buy DOWN &#9660;';
        updateTradeSummary();
    });
    
    // Quick amount buttons
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            DOM.tradeAmount.value = btn.dataset.amount;
            updateTradeSummary();
        });
    });
    
    // Amount input change
    DOM.tradeAmount.addEventListener('input', updateTradeSummary);
    
    // Place trade button
    DOM.tradeBtn.addEventListener('click', placeTrade);
    
    // Modal close
    DOM.modalCloseBtn.addEventListener('click', () => {
        DOM.modalOverlay.style.display = 'none';
        startNewRound();
    });
    
    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && state.marketActive && DOM.modalOverlay.style.display === 'none') {
            placeTrade();
        }
    });
}

// ============ INITIALIZATION ============
async function init() {
    setupEventListeners();
    updateBalance();
    updateTradeSummary();
    
    showToast('Welcome! Starting BTC 5-min prediction...', 'info');
    
    // Start first round
    await startNewRound();
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
