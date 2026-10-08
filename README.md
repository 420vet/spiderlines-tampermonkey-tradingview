# PaintFloid's Spiderlines Tampermonkey-Tradingview

A Tampermonkey userscript that draws **spiderlines** on TradingView with TradingView's own **Ray** drawing tool. Each ray starts at an anchor point you choose and passes through a confirmed pivot high or low that comes after it.

The rays are ordinary TradingView drawings, so they:

- can be edited, moved, restyled or deleted like any ray you draw by hand
- are saved in your chart layout and are still there after a page reload
- show on **every timeframe**, anchored to the same time and price

## Installation

1. Install the **Tampermonkey** extension in your browser (Brave, Chrome, Edge or Firefox).
2. **Chromium browsers (Brave, Chrome, Edge):** open `brave://extensions` (or `chrome://extensions` / `edge://extensions`), open **Details** for Tampermonkey and turn on **Allow User Scripts**. On older browser versions, turn on **Developer mode** (top right) instead.
3. Open the install link and click **Install** in the Tampermonkey dialog:
   **[spiderlines.user.js](https://raw.githubusercontent.com/420vet/spiderlines-tampermonkey-tradingview/main/spiderlines.user.js)**
4. Open or reload a chart at `https://www.tradingview.com/chart/`. The **PaintFloid's Spiderlines** panel appears near the top right of the page.

Tampermonkey checks the same URL for new versions, so updates install automatically.

## Usage

The panel can be dragged by its header and collapsed with the `_` button. Every control has a tooltip, and your settings are remembered.

### Anchor

| Control | What it does |
|---|---|
| **Pick on chart** | Starts picking. The next click on the chart sets the anchor to that candle's time and price. Click the button again to cancel. |
| **Snap wick** | When picking, moves the anchor price to the nearer wick (high or low) of the clicked candle. |
| **Time / Price** | Shows the anchor and lets you edit it by hand. Time is in your local timezone. |
| **Snap high / Snap low** | Sets the anchor price to the high or low of the anchor candle. |

### Pivots

| Control | What it does |
|---|---|
| **Highs** checkbox, color, left, right | Draws rays to pivot highs. Left and right are the number of bars needed on each side, as in `ta.pivothigh(left, right)`. |
| **Lows** checkbox, color, left, right | The same for pivot lows (`ta.pivotlow`). Highs and lows can be shown together. |
| **Max lines** | The maximum number of rays per draw. The most recent pivots are kept. |

### Style

| Control | What it does |
|---|---|
| **Width / Style** | Ray width (1–4) and style (solid, dashed or dotted). |

### Actions

| Button | What it does |
|---|---|
| **Draw** | Draws rays from the anchor to every confirmed pivot on the current timeframe. |
| **Redraw** | Removes this symbol's spiderlines and draws them again with the current settings. |
| **Clear** | Removes every ray this script created on the current symbol. It works from any timeframe. |

### Typical workflow

1. Open a chart, such as BTCUSDT 1h.
2. Click **Pick on chart**, then click the swing you want to use as the anchor.
3. Choose Highs and/or Lows and adjust left/right bars if needed.
4. Click **Draw**.
5. Switch timeframes. The rays stay in place.

## How it works

- The script reads the bars loaded on the chart and finds the anchor candle by time.
- Pivots are found only among candles after the anchor, with the same rules as Pine Script's `ta.pivothigh` / `ta.pivotlow`.
- A pivot is used only once all of its right-side bars have closed. The candle still forming is never used, so rays never repaint.
- Ray points are set by **timestamp and price**, not bar index, so each ray stays on the same real point on every timeframe. All timeframes are turned on in each ray's visibility settings.
- Pivots come from the timeframe you are viewing when you click **Draw**. Use a higher timeframe for major structure and a lower one for detail.
- The script records the rays it creates for each symbol in your browser's local storage, so **Clear** removes only its own rays, never your other drawings.
- It works with any symbol and timeframe.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The panel does not appear | Make sure **Allow User Scripts** (or Developer mode) is on for Tampermonkey, the script is enabled in the Tampermonkey dashboard, and you are on a `/chart` page. Then reload the page. |
| `TradingViewApi not found` | TradingView may have changed its internal API. Please [open an issue](https://github.com/420vet/spiderlines-tampermonkey-tradingview/issues) and paste the status message. |
| `Could not read chart bars` / `Ray creation failed` | Reload the chart. If the error comes back, open an issue with the message and your browser version. |
| `Anchor is older than the loaded history` | Scroll the chart left until TradingView loads bars back to the anchor, then click **Draw** again. |
| `No confirmed pivots after the anchor` | Move the anchor further back, lower the left/right bars, or wait for more candles to close. |

## Disclaimer

This script uses TradingView's undocumented internal web API, which can change at any time without notice. It is not affiliated with or endorsed by TradingView. It is not financial advice. Use it at your own risk.

## License

[MIT](LICENSE) © PaintFloid
