# Intent — Hệ thống hỗ trợ ra quyết định trading FX & Crypto

> Nguồn: phiên brainstorming 2026-07-03 (Creative Partner). Tài liệu này chỉ chứa các quyết định cốt lõi, sẵn sàng đưa vào `bmad-product-brief` / `bmad-prd` / `bmad-spec`.

## Vấn đề & mục tiêu
- **Người dùng:** cá nhân (chính chủ), tự trade FX + Crypto.
- **Mục tiêu:** công cụ hỗ trợ ra quyết định, trọng tâm **kiếm lời bền vững**, mức tự động **auto-suggest** (gợi ý lệnh — người quyết định cuối, KHÔNG tự đặt lệnh).
- **Nỗi đau trung tâm cần chữa:** chu kỳ **give-back** — thắng cả chuỗi rồi thua sạch lợi nhuận, do **overtrade** và **revenge trade** (đặc biệt *sau khi thắng*).

## Nguyên lý nền (bất biến)
1. **Không tiên tri giá.** Giá là thứ không điều khiển được. Hệ thống chỉ đề xuất các hành động người dùng *kiểm soát được*: bấm/không bấm, size, stop, exit. Im lặng cũng là một khuyến nghị.
2. **Đây là cỗ máy ép kỷ luật**, không phải máy dự đoán. Thắng dài hạn = chất lượng & tính nhất quán của quy trình, không phải từng lệnh.
3. **Thước đo uy tín = EXPECTANCY** (kỳ vọng lời/lệnh qua thời gian dài × R:R được kiểm soát chặt) + **max drawdown thấp**. KHÔNG dùng win rate làm thước đo chính (win-rate cao là cái bẫy tạo give-back).
4. **"Rule cho thứ cần TIN & backtest được; LLM cho thứ cần DIỄN GIẢI."** Determinism ở nơi có tiền & kỷ luật; intelligence ở nơi có mơ hồ.

## Kiến trúc quyết định: tháp 4 tầng phân cấp (hierarchical + veto)
Một lệnh chỉ được đề xuất khi tín hiệu đi lọt từ trên xuống dưới; tầng nào chặn thì dừng (mặc định = không làm gì).

- **Tầng 0 — Hành vi (quyền veto tối cao):** cooldown sau lệnh lỗ · giới hạn số lệnh/ngày · **siết size khi đang thắng chuỗi** (coi win-streak là TRẠNG THÁI NGUY HIỂM, không phải đèn xanh) · blackout quanh tin FX mạnh.
- **Tầng 1 — Regime + Edge/hướng:** xác định chế độ thị trường & phía edge. FX: edge = price-action đọc vùng thanh khoản; tin tức chỉ đóng vai lọc rủi ro (blackout). Crypto: đọc thanh khoản bằng data (funding, OI, long/short ratio, CVD). Không rõ hướng → không tín hiệu.
- **Tầng 2 — Điểm vào (price action):** hệ thống **tự khoanh vùng vào lệnh** theo hướng Tầng 1 cho phép; **không tự đặt lệnh** — người dùng xác nhận.
- **Tầng 3 — Risk/Sizing:** size theo % rủi ro cố định + stop + kiểm **R:R tối thiểu**; R:R không đạt → huỷ đề xuất. Deterministic 100%.

## Vai trò của LLM (LLM-only, KHÔNG dùng ML)
LLM bị nhốt trong các vai, **không bao giờ được cầm cò tạo lệnh**:
1. **Diễn giải (MUST):** sau khi rule bật đèn xanh, viết cái *"tại sao"* bằng tiếng người → xây niềm tin để người dùng chịu bấm + làm nhật ký review.
2. **Đọc ngữ cảnh mờ → tag cấu trúc (v2):** nuốt tin/lịch kinh tế → xuất tag có cấu trúc cho rule dùng.
3. **Phản biện/veto một chiều (v2):** chỉ được làm thận trọng hơn, không bao giờ làm liều hơn.
- Ràng buộc: temperature thấp · **log mọi prompt/response để audit**.

## Nguồn dữ liệu
- **Binance API (free):** klines, order book/aggTrades (→ CVD), **funding rate**, **open interest**, **long/short ratio**, mark/index (→ basis). Đủ ~80% Tầng-1 crypto với chi phí $0.
- **Không lấy được từ Binance:** liquidation heatmap đầy đủ (cần Coinglass/Hyblock — trả phí), on-chain/exchange flow (Glassnode/CryptoQuant), lịch tin FX (ForexFactory/investing).

## Phạm vi (MoSCoW)
- **MUST (v1):** Tầng 0 hành vi · Tầng 3 sizing/stop/R:R · blackout tin FX · Crypto Tier-1 rule từ Binance free · Tầng 2 tự khoanh vùng (không tự đặt lệnh) · **LLM diễn giải** · **backtest engine đo expectancy/max-DD**.
- **SHOULD:** hoàn thiện nhật ký/audit review.
- **COULD (v2):** LLM đọc-tin→tag & veto một chiều · liquidation heatmap · on-chain data.
- **WON'T (lần này):** full auto đặt lệnh · ML dự đoán giá.

## Rủi ro/điểm cần kiểm chứng khi build
- Giới hạn Binance `forceOrder` (liquidation stream) có thể đã thay đổi — tra docs live khi triển khai.
- Backtest engine là điều kiện tiên quyết: không chứng minh được expectancy ⇒ không tin ⇒ hệ thống vô dụng.
- Niềm tin (không phải độ chính xác) là bài toán trung tâm — mọi thành phần phải phục vụ việc khiến người dùng *chịu tuân theo*.
