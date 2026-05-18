# PolyBTC — Polymarket BTC 5-min Mirror | Polymarket BTC 5分钟镜像

A browser-based paper trading app that mirrors live data from Polymarket's BTC 5-minute prediction markets. Real odds, real countdown, fake money.

一个基于浏览器的模拟交易应用，实时镜像 Polymarket 上 BTC 5分钟预测市场的数据。真实赔率、真实倒计时、虚拟资金。

---

## Features | 功能

| English | 中文 |
|---------|------|
| Live odds from Polymarket CLOB API (refresh every 2s) | 实时赔率，来自 Polymarket CLOB API（每 2 秒刷新） |
| Countdown synced to actual market end time | 倒计时与真实市场结束时间同步 |
| Real BTC price from Binance API | 真实 BTC 价格来自 Binance API |
| Live odds chart (UP% + BTC%) | 实时赔率折线图（UP% + BTC%） |
| Buy UP / DOWN with paper money | 用虚拟资金买涨/买跌 |
| **Sell anytime** at current market price | **随时卖出**（按当前市场价） |
| Auto-discover next market when one resolves | 当前市场结束后自动寻找下一个 |
| Trade history & performance stats | 交易历史 & 表现统计 |

---

## Installation | 安装

### Prerequisites | 前置要求

- **Python 3** installed (for the local HTTP server)
- A modern browser (Chrome, Edge, Firefox)
- Internet connection (to reach Polymarket and Binance APIs)

— — —

- 已安装 **Python 3**（用于启动本地 HTTP 服务器）
- 现代浏览器（Chrome、Edge、Firefox 都可以）
- 网络连接（访问 Polymarket 和 Binance API）

### Step 1 — Get the code | 获取代码

**Option A: Clone with git**
```bash
git clone https://github.com/qin135627/-.git
cd -/poly-btc-sim
```

**Option B: Download ZIP**

1. Open https://github.com/qin135627/- in your browser
2. Click the green **Code** button → **Download ZIP**
3. Extract the ZIP, then go into the `poly-btc-sim/` folder

— — —

**方式 A：用 git 克隆**
```bash
git clone https://github.com/qin135627/-.git
cd -/poly-btc-sim
```

**方式 B：下载 ZIP**

1. 浏览器打开 https://github.com/qin135627/-
2. 点击绿色 **Code** 按钮 → **Download ZIP**
3. 解压后进入 `poly-btc-sim/` 文件夹

---

## Running | 运行

### Easiest way — start scripts | 最简单：双击启动脚本

- **Windows**: double-click `start.bat` | 双击 `start.bat`
- **Mac / Linux**: in terminal run `./start.sh` | 终端运行 `./start.sh`

Your browser will open automatically at http://localhost:8080

浏览器会自动打开 http://localhost:8080

### Manual way | 手动启动

In the `poly-btc-sim/` folder, open a terminal:

在 `poly-btc-sim/` 文件夹打开终端：

```bash
python -m http.server 8080
# or | 或者
python3 -m http.server 8080
```

Then open http://localhost:8080 in your browser.

然后浏览器访问 http://localhost:8080。

> **Important** | **重要**: Do NOT just double-click `index.html` directly. Browsers block API calls when files are opened via `file://`. You must run the local server.
>
> 不要直接双击 `index.html`。`file://` 协议下浏览器会拦截 API 请求，必须通过本地服务器访问。

---

## Usage | 使用

### Reading the screen | 看懂界面

| Element | English | 中文 |
|---------|---------|------|
| LIVE / WAITING / RESOLVED | Market status | 市场状态 |
| BTC Price | Real BTC/USDT from Binance | Binance 上 BTC/USDT 实时价格 |
| Start Price | BTC price when market began | 市场开始时的 BTC 价格 |
| Time Left | Countdown to market end (synced with Polymarket) | 倒计时（与 Poly 同步） |
| Poly Volume | Trading volume on Polymarket | Polymarket 上的交易量 |
| UP / DOWN % | Current Polymarket midpoint odds | 当前 Polymarket 赔率（中间价） |
| Live Odds Chart | Green = UP%, Orange = BTC% change | 绿线 = UP%，橙线 = BTC% 变化 |

### Trading | 交易

1. **Choose side** | **选择方向**: Click `Buy UP ▲` or `Buy DOWN ▼` | 点击买涨或买跌
2. **Enter amount** | **输入金额**: Type a USD amount or click a quick button ($5–$100) | 输入金额或点快捷按钮
3. **Place trade** | **下单**: Click the big trade button (or press Enter) | 点击下单按钮（或按回车）
4. **Watch your position** | **观察持仓**: Unrealized P&L updates live | 浮动盈亏实时更新
5. **Sell anytime** | **随时卖出**: Click the blue `SELL` button on any position to cash out at current market price | 点击仓位上的蓝色 `SELL` 按钮，按当前市场价立刻卖出
6. **Or hold to resolution** | **或持有到结算**: When the timer hits 0:00, market resolves based on whether BTC went up or down | 等到倒计时归零，根据 BTC 涨跌结算

### How profit works | 收益规则

- Each share pays **$1 if you win**, **$0 if you lose** | 每股赢得 $1，输掉变 $0
- If you buy at $0.55, you can sell later at any current price (up to $1) | 以 $0.55 买入，之后可以按当前价卖出（最高 $1）
- **Sell early** to lock in profits or cut losses before resolution | 提前卖出可以锁定利润或止损
- **Hold to end** for full payout if your side wins | 持有到结算，赢了拿满 $1/股

---

## Verifying real data | 验证数据真实

1. Click the **"View on Polymarket →"** link at the top of the card | 点击页面顶部 **"View on Polymarket →"** 链接
2. Compare the odds & countdown side-by-side with the official Polymarket page | 对比 Polymarket 官网的赔率和倒计时

They should match within 1-2 seconds (CLOB midpoint can differ slightly from Polymarket's UI).

数据应该在 1-2 秒内一致（CLOB 中间价可能与 Polymarket 网页 UI 略有差异）。

---

## Troubleshooting | 故障排查

| Problem | Cause / Fix | 问题 | 原因 / 解决 |
|---------|-------------|------|-------------|
| "WAITING" status | No active 5-min market right now | 显示 "WAITING" | 当前没有活跃的 5 分钟市场 |
| BTC Price stuck on "Loading..." | Binance API blocked (try with VPN) | BTC 价格一直 Loading | Binance API 被屏蔽（试试 VPN） |
| Odds frozen | API rate limit; wait 30s | 赔率不动 | API 限流；等 30 秒 |
| Page won't load | You opened `index.html` directly. Use `python -m http.server` | 页面打不开 | 直接打开 index.html 不行，必须用 python 启动服务器 |
| Cannot click SELL | Waiting for first price refresh | 不能点 SELL | 首次价格还没拉到 |

---

## API Endpoints Used | 使用的 API

This app reads only **public, no-auth endpoints**. No wallet, no API key.

本应用只读取**公开的、无需认证**的端点。无需钱包、无需 API Key。

| Service | URL |
|---------|-----|
| Polymarket Gamma | `https://gamma-api.polymarket.com/events?slug=...` |
| Polymarket CLOB | `https://clob.polymarket.com/midpoint?token_id=...` |
| Binance | `https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT` |
| CoinGecko (fallback) | `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin` |

---

## Disclaimer | 免责声明

This is a **paper trading** simulator. No real money is involved, no real trades are placed on Polymarket. Use at your own risk for educational purposes only.

本应用为**模拟盘**。不涉及真实资金，不会在 Polymarket 上下任何真实订单。仅供学习和娱乐使用，使用风险自负。

---

## License | 许可证

MIT — feel free to fork and modify | MIT — 欢迎 Fork 和修改
