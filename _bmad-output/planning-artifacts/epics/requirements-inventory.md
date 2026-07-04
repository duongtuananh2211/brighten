# Requirements Inventory

## Functional Requirements

FR-1: Tầng 0 — Phủ quyết hành vi. Hệ thống chặn tạo Đề xuất mới khi bất kỳ luật kỷ luật nào kích hoạt: cooldown sau lỗ, max_trades_per_day, siết size khi thắng chuỗi, daily_loss_limit, news blackout FX; mọi lần chặn ghi Nhật ký.
FR-2: Tầng 1 — Regime + Edge/hướng. Crypto: tính hướng từ funding/OI/long-short/CVD (Binance). FX: hướng từ price action vùng thanh khoản (tin KHÔNG chọn hướng). Mâu thuẫn/dưới ngưỡng → "không có hướng", dừng pipeline.
FR-3: Tầng 2 — Khoanh vùng điểm vào (price action). Chỉ tìm điểm vào theo hướng Tầng 1 cho phép; không có setup → chờ; vùng vào xuất ra dạng người dùng đọc & xác nhận; KHÔNG tự đặt lệnh.
FR-4: Tầng 3 — Risk/Sizing tất định. Khối lượng từ % rủi ro cố định + khoảng stop; stop theo cấu trúc giá; R:R < min_rr → huỷ; cùng input → cùng output.
FR-5: Thu thập dữ liệu crypto Binance (free). Nến, order book/trades→CVD, funding, OI, long/short, mark/index→basis. Có real-time + lấy lịch sử cho backtest; endpoint lỗi → suy giảm mềm + log, không phát Đề xuất trên dữ liệu thiếu.
FR-6: Lịch kinh tế FX. Nạp lịch tin high-impact (NFP, CPI, FOMC, lãi suất) → gắn cửa sổ blackout cho Tầng 0.
FR-7: LLM Narrator sinh lý do. Sinh giải thích ngắn cho mỗi Đề xuất, chỉ tham chiếu tín hiệu đã kích hoạt; nhiệt độ thấp; log prompt/response; LLM lỗi → Đề xuất vẫn hiện (ghi chú thiếu lý do).
FR-8: Backtest toàn pipeline với chi phí thật. Cộng phí + spread + slippage + funding; xuất expectancy ròng (R), max drawdown, phân phối R-multiple, đường equity; win rate chỉ tham khảo.
FR-9: Kỷ luật chống overfit. Walk-forward + khối holdout không tối ưu; khoảng tin cậy expectancy (Monte Carlo/xáo thứ tự lệnh); chế độ forward paper-trade trước vốn thật; trần số tham số.
FR-10: Live-drift auto-halt. Theo dõi Live-drift như chỉ số hạng nhất, hiển thị thường trực; expectancy thực chiến trượt dưới khoảng tin cậy backtest → tự giảm size/tạm dừng + báo lý do.
FR-11: Cost hurdle. Tín hiệu chỉ thành Đề xuất nếu edge kỳ vọng vượt ≥ X× phí round-trip (X cấu hình); theo dõi tỷ lệ phí/lãi gộp → cờ đỏ overtrade khi vượt ngưỡng.
FR-12: Ma sát override. Override một chặn Tầng 0 đòi cooldown ngắn + xác nhận gõ tay; mọi override ghi Nhật ký (thời điểm, luật bị vượt, lý do).
FR-13: Trình Đề xuất để xác nhận (auto-suggest, không auto-execute). Đề xuất gồm hướng, khối lượng, stop, target/R:R, lý do; không có Đề xuất → trạng thái "chờ/không có edge"; KHÔNG có đường tự gửi lệnh tới sàn.
FR-14: Nhật ký audit bất biến. Ghi mọi Đề xuất, tín hiệu kích hoạt, lý do LLM, lần chặn, lần override; đủ để review lại vì sao một Đề xuất xuất hiện hoặc bị chặn.

## NonFunctional Requirements

NFR-1: Tất định & tái lập — lõi rule (Tầng 0, Tầng 3, cost hurdle, sizing) cùng input → cùng output, để backtest đáng tin.
NFR-2: Khả kiểm (auditability) — mọi Đề xuất/tín hiệu/lý do LLM/chặn/override ghi bất biến.
NFR-3: An toàn LLM — nhiệt độ thấp, log toàn bộ prompt/response, LLM không nằm trên đường quyết định.
NFR-4: Độ trễ — pipeline chạy đủ nhanh để Đề xuất kịp thời (định lượng sau theo khung thời gian trade) `[ASSUMPTION]`.
NFR-5: Bền dữ liệu — nguồn dữ liệu lỗi/thiếu → không phát Đề xuất trên dữ liệu khuyết + ghi log.
NFR-6: Tầng 0 & Tầng 3 tất định 100% (không AI/LLM), tái lập được để backtest.

## Additional Requirements

Từ Architecture Spine (AD = Architecture Decision) + Solution Design:

- **[STARTER — greenfield] Không có starter template có sẵn.** Dự án là **monorepo greenfield TypeScript**. Epic 1 Story 1 = dựng scaffold: `packages/decision-core` (lõi thuần) · `packages/adapters` · `packages/config` · `apps/web` (Next.js) · `apps/cron-runner` (Supabase Edge/Deno) · `apps/backtest-cli` (Node) · `supabase/migrations`.
- **[AD-1] Topology stateless serverless + Postgres + cron poll** — không tiến trình always-on v1; pipeline chạy scheduled tick ~1 phút (pg_cron → pg_net → Edge Function); mọi state bền ở Postgres.
- **[AD-2] Lõi thuần tất định** — `decision-core` cấm network/disk/clock/random trực tiếp; thời gian & dữ liệu vào lõi chỉ qua port; lint chặn `Date.now()`/`Math.random()`.
- **[AD-3] Một engine, hai driver** — live (cron) và backtest import cùng `decision-core`; cấm cài đặt lại luật trong driver.
- **[AD-4] Config có phiên bản + snapshot** — tham số điều chỉnh-được lưu versioned; mỗi Đề xuất & BacktestRun nhúng snapshot config đã dùng.
- **[AD-5] Thứ tự gating Tầng 0→1→2→3** — Tầng 0 veto tối cao; bất kỳ tầng chặn → im lặng.
- **[AD-6] Một chủ sở hữu behavioral state** — decision-engine sở hữu; đổi qua đúng 2 event: `market-tick` (cron), `trade-outcome` (feedback); UI chỉ đọc.
- **[AD-7] Feedback loop hybrid** — Binance read-only API dò vị thế/fill/PnL + user xác nhận fill↔Đề xuất; khóa API chỉ đọc.
- **[AD-8] Nhật ký audit append-only** — không UPDATE/DELETE.
- **[AD-9] LLM narrator ngoài đường quyết định** — sau narrator port; không đọc/ghi state.
- **[AD-10] Vercel cô lập** — chỉ đọc Postgres + hiển thị + realtime; không chạy pipeline; không tồn tại đường gửi lệnh tới sàn (SAFETY).
- **[AD-11] Ingestion sau port; suy giảm mềm** — v1 Binance REST poll + FX calendar; v2 streaming = adapter mới.
- **[AD-12] Suy diễn tín hiệu trong lõi thuần** — adapter chỉ giao dữ liệu thô chuẩn hóa; CVD/regime/vùng thanh khoản tính trong core.
- **[Conventions]** không dùng JS `number` cho tiền (decimal/string); UTC epoch-millis; UUID v7; ranh giới trading-day cấu hình (mặc định UTC 00:00); shape `MARKET_SNAPSHOT` do ingestion adapter sở hữu; lỗi shape `{code,source,context}`; secrets per-runtime.
- **[Stack]** TypeScript ^5 · Next.js 16.2.x LTS · Node 22 LTS · Deno (Supabase Edge) · Supabase (Postgres 15+, pg_cron, pg_net, Realtime, Edge Functions) · Binance API read-only · Claude Haiku 4.5 (`claude-haiku-4-5`) narrator.

## UX Design Requirements

(Không có tài liệu UX — solo tool, UJ giữ nhẹ. UI của `apps/web` là bề mặt đọc + xác nhận, không có UX spec riêng.)

## FR Coverage Map

FR-1: Epic 1 — Tầng 0 phủ quyết hành vi (deterministic, backtestable)
FR-2: Epic 2 — Tầng 1 regime + edge/hướng
FR-3: Epic 2 — Tầng 2 khoanh vùng điểm vào
FR-4: Epic 1 — Tầng 3 risk/sizing (deterministic)
FR-5: Epic 1 (lịch sử, cho backtest) + Epic 3 (live/poll)
FR-6: Epic 2 — lịch tin FX → blackout Tầng 0
FR-7: Epic 4 — LLM narrator diễn giải
FR-8: Epic 1 — backtest chi phí thật
FR-9: Epic 1 — kỷ luật chống overfit
FR-10: Epic 3 (logic auto-halt) + Epic 4 (hiển thị thường trực)
FR-11: Epic 1 — cost hurdle (cổng Tầng 3)
FR-12: Epic 3 (logic ma sát) + Epic 4 (surface xác nhận)
FR-13: Epic 4 — trình Đề xuất để xác nhận
FR-14: Epic 3 — nhật ký audit append-only
