# Spec kỹ thuật v1 — Trading Decision Support System (FX + Crypto)

> Bản đặc tả để bắt tay xây v1. Rút từ phiên brainstorming 2026-07-03.
> Triết lý: **cỗ máy ép kỷ luật, không tiên tri giá.** Output = đề xuất hành động, không bao giờ tự đặt lệnh.

---

## 1. Kiến trúc tổng thể — Pipeline 4 tầng

```
        Market data + News  ──►  ┌──────────────────────────────┐
                                 │ TẦNG 0 — HÀNH VI (veto tối cao)│  chặn → im lặng
                                 └──────────────┬───────────────┘
                                                ▼ (được phép săn)
                                 ┌──────────────────────────────┐
                                 │ TẦNG 1 — REGIME + EDGE/HƯỚNG  │  không rõ hướng → bỏ qua
                                 └──────────────┬───────────────┘
                                                ▼ (hướng xác định)
                                 ┌──────────────────────────────┐
                                 │ TẦNG 2 — PRICE ACTION (điểm vào)│  không có setup → chờ
                                 │  → TỰ KHOANH VÙNG, KHÔNG đặt lệnh│
                                 └──────────────┬───────────────┘
                                                ▼
                                 ┌──────────────────────────────┐
                                 │ TẦNG 3 — RISK/SIZING          │  R:R < ngưỡng → huỷ
                                 └──────────────┬───────────────┘
                                                ▼
                                 ┌──────────────────────────────┐
                                 │ LLM — DIỄN GIẢI "TẠI SAO"     │  (chỉ giải thích, không quyết)
                                 └──────────────┬───────────────┘
                                                ▼
                    ĐỀ XUẤT: "Điểm này phù hợp để vào — [hướng], size X%, stop @Y, R:R Z. Lý do: …"
                                        (người dùng xác nhận)
```

**Nguyên tắc thực thi:** deterministic ở Tầng 0 & 3 (không AI); rule + LLM-diễn-giải ở Tầng 1 & 2. Mọi output là hành động kiểm soát được, không phải dự đoán giá.

---

## 2. Đặc tả từng tầng

### Tầng 0 — Hành vi (Deterministic 100%)
Mục tiêu: chặn **give-back / overtrade / revenge**. Đây là trái tim hệ thống.

| Luật | Mô tả | Tham số (mặc định đề xuất — cần backtest/điều chỉnh) |
|------|-------|------|
| Cooldown sau lỗ | Vừa đóng lệnh lỗ → khoá đề xuất lệnh mới | `cooldown_after_loss = 30–60 phút` |
| Giới hạn lệnh/ngày | Chặn overtrade | `max_trades_per_day = N` |
| Siết size khi thắng chuỗi | Thắng ≥ K lệnh liên tiếp → giảm size cho phép / tăng ngưỡng vào | `win_streak_threshold = 3`, `size_dampening = 0.5×` |
| Giới hạn lỗ ngày | Đạt mức lỗ ngày → khoá tới hết ngày | `daily_loss_limit = % vốn` |
| Blackout tin FX | Khoá ±X phút quanh tin high-impact (NFP, CPI, FOMC, lãi suất) | `news_blackout = ±15–30 phút`; nguồn: ForexFactory/investing calendar |

→ Nếu bất kỳ luật nào chặn: hệ thống **im lặng** (không đề xuất). Ghi log lý do chặn.

### Tầng 1 — Regime + Edge/hướng (Rule; LLM chỉ đọc ngữ cảnh ở v2)
Xác định: (a) chế độ thị trường (trending vs sideway), (b) phía edge.

**FX:** edge = **price action đọc vùng thanh khoản** (triết lý smart-money / liquidity). Tin tức KHÔNG dùng chọn hướng — chỉ là bộ lọc rủi ro ở Tầng 0.

**Crypto (dùng Binance free):**
- `funding_rate` cực trị → đám đông đang kẹt một phía (nhiên liệu cho cú quét ngược).
- `open_interest` + hướng giá → tiền mới vào (OI↑ giá↑ = trend thật) vs tháo chạy (OI↓ = short cover, dễ hết hơi).
- `long_short_ratio` (account & top-trader position) → sentiment đo được.
- `CVD` (từ aggTrades) → ai đang thực sự đẩy giá.
- Luật mẫu: *"funding lệch mạnh một phía + OI xác nhận + giá áp một hồ thanh khoản ngược đám đông → nghiêng hướng đó."*

→ Không xác định được hướng rõ ràng → **không tín hiệu**.

### Tầng 2 — Price action / điểm vào (Rule; bán tự động)
- Chỉ tìm điểm vào **theo hướng Tầng 1 cho phép**.
- Hệ thống **tự khoanh vùng vào lệnh** (vùng giá + điều kiện xác nhận) và trình cho người dùng.
- **KHÔNG tự đặt lệnh** — người dùng xác nhận/bác.
- Không có setup đạt chuẩn → chờ, không ép.

### Tầng 3 — Risk / Sizing (Deterministic 100%)
- `position_size` tính từ **% rủi ro cố định** trên vốn (vd 1%/lệnh) và khoảng cách stop.
- Stop đặt theo cấu trúc (dưới/trên vùng thanh khoản), không tuỳ hứng.
- Tính **R:R**; nếu `R:R < min_rr` (vd 1.5–2.0) → **huỷ đề xuất**.

### LLM — Diễn giải (MUST v1)
- **Sau** khi rule đã cho ra đề xuất, LLM viết cái *"tại sao"* bằng tiếng người (dùng chính các tín hiệu rule đã kích hoạt).
- Vai trò: xây niềm tin để người dùng chịu bấm + tạo nhật ký để review.
- Ràng buộc: **temperature thấp**, **log toàn bộ prompt/response**. LLM KHÔNG được tạo/đổi hướng lệnh.

---

## 3. Nguồn dữ liệu

| Loại | Nguồn v1 | Ghi chú |
|------|----------|---------|
| Nến, order book, trades | **Binance API (free)** REST + WebSocket | nền của TA + CVD |
| Funding / OI / L-S ratio / basis | **Binance Futures API (free)** | lõi Tầng-1 crypto |
| Lịch tin FX | ForexFactory / investing feed | cho blackout Tầng 0 |
| Liquidation heatmap | Coinglass / Hyblock (**v2, trả phí**) | Binance không cho lịch sử đầy đủ |
| On-chain / exchange flow | Glassnode / CryptoQuant (**v2**) | free tier hạn chế |

⚠️ **Kiểm chứng khi build:** giới hạn stream `forceOrder` của Binance có thể đã đổi — tra docs live.

---

## 4. Backtest engine (MUST — điều kiện tiên quyết)
Không có phần này thì người dùng không thể *tin* → hệ thống vô dụng.
- Chạy toàn pipeline trên dữ liệu lịch sử.
- Xuất **expectancy (lời kỳ vọng/lệnh)**, **max drawdown**, phân phối R-multiple, đường equity.
- KHÔNG lấy win-rate làm chỉ số uy tín chính (chỉ tham khảo).
- Cho phép tinh chỉnh tham số Tầng 0/1/3 và đo lại.

---

## 5. Phạm vi build (MoSCoW)
- **MUST (v1):** Tầng 0 · Tầng 3 · blackout tin FX · Crypto Tier-1 Binance-free · Tầng 2 tự khoanh vùng (không đặt lệnh) · LLM diễn giải · backtest engine.
- **SHOULD:** nhật ký/audit review hoàn chỉnh.
- **COULD (v2):** LLM đọc-tin→tag & veto một chiều · liquidation heatmap · on-chain data.
- **WON'T (lần này):** full auto đặt lệnh · ML dự đoán giá.

## 6. Thứ tự triển khai gợi ý
1. Kết nối Binance data + backtest engine (khung xương + thước đo niềm tin).
2. Tầng 3 (sizing/risk) + Tầng 0 (hành vi) — deterministic, dễ backtest, giá trị chống give-back cao nhất.
3. Tầng 1 crypto rule (funding/OI/L-S/CVD) + blackout tin FX.
4. Tầng 2 khoanh vùng price action.
5. LLM diễn giải + logging.
6. (v2) heatmap, on-chain, LLM đọc-tin/veto.
