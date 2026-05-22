# PolyBTC - Polymarket BTC 模拟交易器

一个基于 Polymarket 真实数据的 BTC 5分钟/15分钟涨跌预测模拟交易工具。所有赔率数据来自 Polymarket CLOB，BTC 价格来自 Binance，完全模拟真实交易环境。

---

## 功能特性

- 实时拉取 Polymarket BTC 5min/15min 市场赔率
- 实时 BTC 价格（Binance）
- Polymarket 动态手续费机制（赔率50%时最高约3.12%）
- 3秒执行延迟 + 滑点模拟
- 交易笔记（记录每笔交易理由）
- 数据持久化（刷新不丢失余额、历史、统计）
- 随时 SELL 平仓
- 移动端适配

---

## 安装与启动

### 第一步：下载文件

打开 **PowerShell**，执行以下命令：

```powershell
# 创建文件夹（如果还没有的话）
New-Item -ItemType Directory -Force -Path "B:\新建文件夹\poly\--master\poly-btc-sim"

# 进入文件夹
cd "B:\新建文件夹\poly\--master\poly-btc-sim"

# 下载3个文件
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/qin135627/-/feature/poly-fee-and-persistence/poly-btc-sim/app.js" -OutFile "app.js"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/qin135627/-/feature/poly-fee-and-persistence/poly-btc-sim/index.html" -OutFile "index.html"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/qin135627/-/feature/poly-fee-and-persistence/poly-btc-sim/style.css" -OutFile "style.css"
```

### 第二步：启动本地服务器

```powershell
cd "B:\新建文件夹\poly\--master\poly-btc-sim"
python -m http.server 8080
```

### 第三步：打开浏览器

访问：**http://localhost:8080**

---

## 手机访问（同一WiFi）

1. 电脑 PowerShell 输入 `ipconfig`，找到 IPv4 地址（如 `192.168.1.100`）
2. 启动服务器时用：
   ```powershell
   python -m http.server 8080 --bind 0.0.0.0
   ```
3. 手机浏览器打开：`http://192.168.1.100:8080`（换成你的实际IP）

> 如果手机打不开，可能是 Windows 防火墙拦截，PowerShell 管理员执行：
> ```powershell
> netsh advfirewall firewall add rule name="Python HTTP" dir=in action=allow protocol=TCP localport=8080
> ```

---

## 使用教程

### 界面概览

打开后你会看到：

| 区域 | 说明 |
|------|------|
| 顶部 | Paper Balance（模拟余额） |
| 左侧主区 | 市场信息、BTC价格、赔率、图表、交易面板 |
| 右侧 | 操作日志、交易历史、Performance统计 |

### 选择市场周期

页面顶部有 **5 Min** 和 **15 Min** 两个按钮，点击切换：
- 5 Min：Polymarket BTC 5分钟涨跌市场
- 15 Min：Polymarket BTC 15分钟涨跌市场

### 下单交易

1. **选方向**：点击 "Buy UP" 或 "Buy DOWN"
2. **输入金额**：手动输入或点击快捷按钮（$5 / $10 / $25 / $50 / $100）
3. **写笔记**（可选）：在 "Trade Note" 输入框写下交易理由，比如：
   - "BTC突破108k阻力"
   - "赔率偏离，均值回归"
   - "跟随大单方向"
4. **确认下单**：点击绿色/红色按钮

下单后会有 **3秒执行延迟**（模拟真实环境），期间价格可能变动。

### 手续费说明

系统模拟 Polymarket 的动态 Taker Fee：

| 赔率 | 费率 | $10交易费用 |
|------|------|------------|
| 50% | 3.12% | $0.31 |
| 60% | 3.00% | $0.30 |
| 70% | 2.62% | $0.26 |
| 80% | 2.00% | $0.20 |
| 90% | 1.12% | $0.11 |
| 95% | 0.59% | $0.06 |

**规则**：赔率越接近50%，手续费越高；越接近0%或100%，费率越低。买入和卖出都收取手续费。

交易面板中会实时显示：
- **Taker Fee**：本次手续费金额和费率
- **Total Cost**：实际扣款 = 下注金额 + 手续费

### 平仓（卖出）

持仓期间随时可以点 **SELL** 按钮提前平仓：
- 按当前 Polymarket 中间价卖出
- 卖出也收取动态手续费
- 卖出后立即结算，收益/亏损计入历史

### 市场结算

5分钟/15分钟到期后自动结算：
- BTC 价格高于开始价 → UP 赢
- BTC 价格低于开始价 → DOWN 赢
- 赢了的仓位获得 payout（shares数量的美元）
- 输了的仓位归零

结算后会弹出结果窗口，点 "Next Market" 自动寻找下一个市场。

---

## 数据保存

**所有数据自动保存在浏览器 localStorage 中**，包括：
- 账户余额
- 交易历史（含笔记）
- 胜率、盈亏统计
- 累计手续费

**刷新页面不会丢失数据**。

注意事项：
- 数据存在浏览器本地，换浏览器/清除浏览器数据会丢失
- 电脑和手机的数据各自独立
- 点 "Reset All" 按钮可以重置所有数据，余额恢复 $1,000

---

## 交易笔记

每笔交易前可以在 **Trade Note** 输入框写下理由：
- 下单成功后自动清空，不影响下一笔
- 笔记跟随交易保存在历史记录中
- 在右侧 Trade History 中以斜体显示
- 鼠标悬停可查看完整内容
- 刷新后笔记仍然保留

**用途**：帮你复盘每笔交易的逻辑，分析哪些判断有效、哪些无效。

---

## 更新文件

如果需要更新到最新版本，重新执行下载命令即可：

```powershell
cd "B:\新建文件夹\poly\--master\poly-btc-sim"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/qin135627/-/feature/poly-fee-and-persistence/poly-btc-sim/app.js" -OutFile "app.js"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/qin135627/-/feature/poly-fee-and-persistence/poly-btc-sim/index.html" -OutFile "index.html"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/qin135627/-/feature/poly-fee-and-persistence/poly-btc-sim/style.css" -OutFile "style.css"
```

> 更新文件不会影响已保存的交易记录（记录在浏览器中，不在文件里）。

---

## 常见问题

**Q: 页面打开后显示 SEARCHING / WAITING？**
A: 正常现象。Polymarket 的 BTC 5min 市场每5分钟开一轮，等几秒到半分钟就会找到。周末市场可能暂停。

**Q: 显示 "No active BTC 5m market"？**
A: Polymarket 可能暂时没有活跃的 5min 市场，尝试切换到 15min，或等待下一轮。

**Q: 交易被拒绝 (slippage > 10%)？**
A: 3秒执行期间价格变动太大，系统自动退款保护你。这和真实 Polymarket 一样。

**Q: 余额变成0怎么办？**
A: 点右侧底部 "Reset All" 按钮，重置为 $1,000 重新开始。

**Q: 能不能关电脑后在手机上继续用？**
A: 需要电脑开着运行服务器。如果想随时随地用，可以部署到 Vercel（免费）。

---

## 技术说明

- 纯前端（HTML + CSS + JS），无需后端
- 数据来源：Polymarket Gamma API + CLOB API + Binance API
- 持久化：浏览器 localStorage
- 手续费公式：`fee = price * (1 - price) * 0.1248`
- 执行延迟：3秒（模拟真实网络延迟）
- 滑点保护：>10% 不利滑点自动退款
