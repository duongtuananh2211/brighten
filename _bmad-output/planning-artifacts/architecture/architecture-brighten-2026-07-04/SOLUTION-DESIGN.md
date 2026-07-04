---
title: Solution Design — Trading DSS (Brighten v1)
companion_of: ARCHITECTURE-SPINE.md
status: draft
created: 2026-07-04
updated: 2026-07-04
---

# Solution Design — Trading DSS (Brighten v1)

> Tài liệu này mang **lý do** đằng sau kiến trúc — thứ mà `ARCHITECTURE-SPINE.md` cố ý bỏ (spine chỉ giữ các *invariant* cần tuân, không giữ rationale). Đọc kèm spine: spine nói *phải làm gì*, tài liệu này nói *tại sao* và *đã loại bỏ gì*.

## 1. Bài toán cốt lõi & ràng buộc cứng

Sản phẩm là **cỗ máy ép kỷ luật**, không phải máy dự đoán giá. Bốn ràng buộc cứng định hình toàn bộ kiến trúc:

1. **Tất định & tái lập** — lõi quyết định (Tầng 0, Tầng 3, cost hurdle, sizing) cùng input phải cho cùng output, nếu không backtest nói dối và "niềm tin" (cái phanh của người dùng) biến thành bàn đạp ga.
2. **SAFETY** — v1 tuyệt đối không có đường code tự gửi lệnh tới sàn.
3. **Form-factor đã chốt** — web app Next.js trên Vercel.
4. **Chi phí thấp** — ưu tiên nguồn free (Binance free, LLM chỉ diễn giải nhiệt độ thấp).

Ràng buộc 1 và 3 va nhau: Vercel là **serverless**, không có tiến trình chạy dài — mà hệ thống cần luồng dữ liệu liên tục + backtest nặng + trí nhớ kỷ luật. Đây là căng thẳng trung tâm phải giải.

## 2. Quyết định trụ cột: topology thực thi

### Nút thắt

Vercel (kể cả bản trả phí) **không có tiến trình always-on**: mỗi request là một function bật-tắt, giới hạn thời gian, không giữ được WebSocket-client mở hàng giờ, không chạy nổi backtest nhiều phút. Đây là bản chất serverless, không phải chuyện gói cước.

### Đã cân nhắc các nơi đặt "worker always-on" (tra 7/2026)

| Nền tảng | Always-on free? | Kết luận |
| --- | --- | --- |
| Vercel | — | Giữ cho **nửa UI** (free đủ). Không bao giờ chạy pipeline. |
| Fly.io | Không (bỏ free tier) | Loại cho mục tiêu $0. |
| Railway | Không ($5/tháng Hobby) | Turnkey nhưng có phí. |
| Render | Web free *ngủ sau 15′*; worker $7 | Không hợp always-on free. |
| **Oracle Cloud Always Free** | **Có** (VM ARM 2 OCPU/12GB, vĩnh viễn) | Lựa chọn $0-always-on thật; đổi lại tự quản VM. |
| Máy cá nhân | Có (free) | Phụ thuộc máy không tắt/mất điện. |
| **Cloudflare** (Workers/DO/Containers) | Không hợp | Outbound WS cap 15′, DO không hibernate outbound, Containers ngủ + beta + $5. Chỉ dùng phụ (R2/DNS/realtime). |

### Bước ngoặt: v1 hầu như không cần always-on

Rà lại tín hiệu v1: **phần lớn poll được qua REST** (funding, OI, long/short ratio, klines). Ngay cả **CVD** cũng xấp xỉ được từ `taker buy/sell volume` trong kline REST, tích luỹ dần trong DB theo phút. Và sản phẩm **cố ý chống tốc độ** (SM-C1: không tối ưu số lệnh; đây không phải scalper HFT) → **độ trễ mức phút hợp triết lý**, thậm chí đúng tinh thần hơn phản ứng từng giây.

### Chọn: Phương án A — stateless serverless + Postgres + cron poll

- **Ingestion + pipeline** = một **scheduled tick (~1 phút)**: `pg_cron` (Supabase) → `pg_net` → **Edge Function (Deno)** chạy `decision-core` → ghi Postgres.
- **State** hoàn toàn trong Postgres. Compute stateless.
- **Backtest** = *cùng* engine thuần đó chạy như **job offline** (Node CLI) — vốn dĩ không cần always-on.
- **UI** = Vercel chỉ đọc Postgres + Supabase Realtime push xuống browser.

**Toàn bộ stack $0/tháng** (Vercel free + Supabase free), không tiến trình always-on nào.

### Vì sao A không phải ngõ cụt (đường lên B đã mở)

"Poll hay stream" chỉ là một **adapter sau ingestion port** (AD-11). Nếu sau này v1 chứng minh cần fidelity tick (CVD/orderbook live), nâng lên **Phương án B (worker always-on trên Oracle free VM hoặc Railway $5)** chỉ là *thay adapter* — không viết lại lõi. Rủi ro của việc chọn A bây giờ gần như bằng không.

## 3. Paradigm: vì sao hexagonal + pure core

Ràng buộc tất định (§1.1) gần như *ép* ra kiến trúc hexagonal:

- Nếu lõi quyết định lẫn IO/thời gian/random, ta **không thể** chạy lại nó trên dữ liệu lịch sử và tin kết quả. Tách lõi thuần ra sau các **port** khiến "live" và "backtest" chỉ là hai **driver** bơm dữ liệu khác nhau vào *cùng một lõi* → backtest trung thực **miễn phí** (AD-2, AD-3).
- Pipeline 4 tầng ánh xạ tự nhiên sang **pipes-and-filters**: mỗi tầng là một filter *pass/veto*, Tầng 0 veto tối cao (AD-5).
- LLM đặt **sau** lõi, sau `narrator` port, ngoài đường quyết định (AD-9) — đúng ràng buộc an-toàn-LLM và khiến LLM lỗi không chặn Đề xuất.

**Một ngôn ngữ, một engine, hai driver:** vì Vercel/Supabase Edge chạy TS/Deno và backtest chạy Node, lõi viết **TypeScript thuần** (portable cả Deno lẫn Node) đóng gói một package. Cấm cài đặt lại luật trong driver (AD-3) — đây là thứ ngăn "bản live" và "bản backtest" âm thầm lệch nhau.

## 4. Vòng dữ liệu & sở hữu state

- **Behavioral state** (chuỗi thắng, lỗ ngày, cooldown, đếm lệnh) có **một chủ duy nhất** là decision-engine, chỉ đổi qua hai event: `market-tick` (cron) và `trade-outcome` (feedback) (AD-6). Ngăn hai nơi cùng sửa → Tầng 0 veto sai.
- **Đóng vòng kết quả lệnh (hybrid, AD-7):** hệ thống không tự đặt lệnh, nên phải *học* kết quả từ đâu. Binance **read-only** API tự dò vị thế/fill/PnL (cho daily-loss & live-drift); user xác nhận fill nào ứng Đề xuất nào (cho win-streak/R chính xác). Khóa API v1 chỉ đọc — không bao giờ đặt lệnh.
- **Nhật ký audit append-only (AD-8):** mọi Đề xuất/tín hiệu/prompt LLM/chặn/override ghi bất biến. Đây là bằng chứng để người dùng *tin* và tự đối chiếu hành vi — chính là cơ chế niềm tin của sản phẩm.
- **Config có phiên bản + snapshot (AD-4):** các tham số (cooldown, ngưỡng, min_rr, risk%…) là config; mỗi Đề xuất và mỗi backtest lưu kèm snapshot config đã dùng → tái lập chính xác kể cả sau khi tinh chỉnh tham số.

## 5. Các lỗ đã bịt ở review adversarial

1. **Suy diễn tín hiệu trong lõi, không trong adapter (AD-12):** nếu adapter tính CVD cho live còn backtest tự tính lại, hai bên lệch → expectancy nói dối. Adapter chỉ giao dữ liệu thô chuẩn hóa; mọi chỉ báo tính trong core.
2. **Ranh giới trading-day cấu hình được (convention):** daily-loss/max-trades/reset chuỗi dùng một mốc ngày duy nhất (mặc định UTC 00:00), không mỗi tầng tự chọn.
3. **Shape `MARKET_SNAPSHOT` do ingestion adapter sở hữu:** một shape chuẩn cho cả live-tick lẫn backtest.
4. **Lệnh discretionary (deferred):** lệnh user tự vào ngoài Đề xuất — mặc định tính vào daily-loss/drift (rủi ro thật) nhưng không tính win-streak (không phải edge hệ thống). Chốt ở config, không đổi kiến trúc.

## 6. Thứ tự build gợi ý

Bám theo spec-v1 §6, khớp với kiến trúc:

1. **Khung xương + thước đo:** `decision-core` skeleton + ports + `backtest-cli` + adapter `binance-rest` (lấy lịch sử) → chạy được backtest rỗng trên dữ liệu thật.
2. **Tầng 3 (sizing/risk) + Tầng 0 (hành vi)** — tất định, dễ backtest, giá trị chống give-back cao nhất. Cùng config versioning (AD-4) + behavioral state (AD-6).
3. **Tầng 1 crypto rule** (funding/OI/L-S/CVD tính trong core, AD-12) + blackout tin FX.
4. **Tầng 2** khoanh vùng price action.
5. **Driver live:** `cron-runner` (Edge Function) + `pg_cron` + feedback loop (AD-7) + audit append-only (AD-8).
6. **UI Vercel** (đọc + realtime) + **LLM narrator** (AD-9).
7. *(v2)* streaming adapter (Phương án B), heatmap, on-chain, LLM đọc-tin/veto — tất cả là adapter/tầng thêm, không đụng lõi.

## 7. Bản đồ tham chiếu nhanh

| Câu hỏi | Trả lời | Invariant |
| --- | --- | --- |
| Chạy pipeline ở đâu? | Supabase Edge Function (Deno), cron ~1′ | AD-1, AD-10 |
| Backtest ở đâu? | Node CLI offline, cùng core | AD-3 |
| State ở đâu? | Postgres, decision-engine sở hữu | AD-6 |
| Vercel làm gì? | Chỉ đọc + hiển thị + realtime | AD-10 |
| Biết lệnh thắng/thua kiểu gì? | Read-only API + user xác nhận | AD-7 |
| Lên streaming sau này? | Thay ingestion adapter | AD-11 |
| Tổng chi phí v1? | $0 (Vercel free + Supabase free) | AD-1 |
