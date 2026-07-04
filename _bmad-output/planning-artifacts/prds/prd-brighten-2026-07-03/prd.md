---
title: Trading DSS — Hệ thống hỗ trợ ra quyết định FX & Crypto
status: final
created: 2026-07-03
updated: 2026-07-03
---

# PRD: Trading DSS — Hệ thống hỗ trợ ra quyết định FX & Crypto
*Tên tạm — xác nhận lại.*

## 0. Mục đích tài liệu
PRD này dành cho chính người xây kiêm người dùng (một cá nhân trade FX & Crypto), làm đầu vào cho các bước downstream (`bmad-architecture`, `bmad-spec`, epics). Nó mô tả **năng lực** cần có, không mô tả cách hiện thực (lựa chọn kỹ thuật nằm ở `addendum.md` / spec-v1.md). Tài liệu xây trên phiên brainstorming 2026-07-03 (`_bmad-output/brainstorming/brainstorm-trading-decision-support-fx-crypto-2026-07-03/`: `brainstorm-intent.md`, `trading-dss-spec-v1.md`, `.memlog.md`) và **bổ sung 3 lá chắn anti-fragility** phát sinh ở vòng Reverse Brainstorming mà intent/spec chưa gồm. Từ vựng tuân theo Glossary (§3); tính năng nhóm lại với FR lồng bên trong; giả định gắn `[ASSUMPTION]` inline và gom ở §9.

## 1. Vision
Hầu hết công cụ trading cố **dự đoán giá** — và thất bại, vì giá là thứ không ai điều khiển được. Sản phẩm này đi ngược lại: nó là một **cỗ máy ép kỷ luật**, không phải máy dự đoán. Nó chỉ đề xuất những hành động người dùng thực sự kiểm soát được — vào/không vào, khối lượng, điểm dừng lỗ, điểm thoát — và **không bao giờ tự đặt lệnh**. Người dùng luôn là người quyết định cuối.

Vấn đề trung tâm nó chữa là **give-back**: người dùng thắng cả chuỗi rồi trả lại sạch lợi nhuận vì overtrade và revenge trade, đặc biệt *sau khi thắng*. Hệ thống biến điều này thành một kiến trúc phân tầng, nơi tầng cao nhất là kỷ luật hành vi có quyền phủ quyết mọi thứ bên dưới. Một chuỗi thắng được đối xử như **trạng thái nguy hiểm**, không phải đèn xanh.

Thứ khiến người dùng chịu tuân theo không phải "độ chính xác" mà là **niềm tin đã được chứng minh**: expectancy dương, ròng sau chi phí, xác thực qua thời gian dài và qua dữ liệu ngoài mẫu. Vì niềm tin là cái phanh, hệ thống phải làm mọi cách để expectancy luôn *trung thực* — nếu không, chính cái phanh sẽ biến thành bàn đạp ga.

## 2. Đối tượng người dùng

### 2.1 Jobs To Be Done
- **Chức năng:** "Cho tôi một tín hiệu đủ uy tín để tôi *chịu nghe*; khi không có tín hiệu, giúp tôi không làm gì."
- **Chức năng:** "Chặn tôi lại khi tôi sắp overtrade hoặc revenge trade — nhất là ngay sau một chuỗi thắng."
- **Cảm xúc:** "Cho tôi một 'tại sao' bằng tiếng người để tôi tin và bấm nút mà không dằn vặt."
- **Cảm xúc/kiểm soát:** "Tôi vẫn muốn là người ra quyết định cuối — hệ thống gợi ý, không thay tôi bấm."
- **Bối cảnh:** "Cho tôi bằng chứng (backtest trung thực + đối chiếu live) rằng hệ thống đáng tin trước khi tôi đặt cược lớn."

### 2.2 Non-Users (v1)
- Người muốn một bot **tự động đặt lệnh** hoàn toàn.
- Nhà đầu tư dài hạn / quản lý danh mục (đây là công cụ ra quyết định vào lệnh, không phải portfolio manager).
- Nhiều người dùng / khách hàng SaaS — v1 là công cụ **một người vận hành**.

### 2.3 Key User Journeys
*Công cụ một-người-vận-hành nên UJ giữ ở dạng nhẹ.*

- **UJ-1. Anh nhận một đề xuất crypto và bấm với niềm tin.** Người dùng, đang theo dõi BTC/USDT, nhận thông báo: hệ thống đã cho tín hiệu qua cả 4 tầng — kèm khối lượng, điểm dừng, R:R, và một đoạn LLM giải thích *"funding dương cực trị + OI xác nhận + giá áp một hồ thanh khoản trên → edge nghiêng short"*. Anh đọc lý do, thấy hợp, xác nhận lệnh trên sàn. Hệ thống ghi đề xuất + lý do vào nhật ký. Realizes toàn pipeline.
- **UJ-2. Hệ thống im lặng, và đó là câu trả lời.** Người dùng mở app lúc thị trường sideway; không tầng nào cho tín hiệu → màn hình trống + dòng chữ *"không có edge rõ ràng — chờ"*. Người dùng không làm gì. (Im lặng = một khuyến nghị.)
- **UJ-3. Hệ thống tự chặn anh sau chuỗi thắng.** Người dùng vừa thắng 4 lệnh liên tiếp và đang hưng phấn muốn vào tiếp. Tầng 0 đã siết size cho phép xuống 0.5× và/hoặc chặn lệnh mới với thông báo *"đang thắng chuỗi — trạng thái nguy hiểm, giảm rủi ro"*. **Edge case:** nếu anh cố override, hệ thống bắt qua một cooldown ngắn + gõ tay xác nhận + ghi vào nhật ký override.
- **UJ-4. Hệ thống tự nghi ngờ chính mình.** Expectancy thực chiến trượt xuống dưới khoảng tin cậy của backtest → hệ thống tự giảm size hoặc tạm dừng và báo *"regime có thể đã đổi, tôi không còn đáng tin — chờ đã"*. Người dùng tôn trọng và dừng.

## 3. Glossary
- **Đề xuất (Suggestion)** — output cuối của hệ thống cho một cơ hội vào lệnh: hướng, khối lượng, điểm dừng lỗ, điểm thoát/target, R:R, và lý do. Không bao giờ tự thực thi.
- **Pipeline quyết định** — chuỗi 4 tầng phân cấp mà một tín hiệu phải đi lọt từ trên xuống mới thành một Đề xuất.
- **Tầng 0 (Hành vi)** — tầng cao nhất, quyền phủ quyết tối cao; thực thi kỷ luật (cooldown, giới hạn lệnh/ngày, siết size khi thắng chuỗi, blackout tin FX).
- **Tầng 1 (Regime + Edge)** — xác định chế độ thị trường và hướng edge.
- **Tầng 2 (Price Action)** — khoanh vùng điểm vào theo hướng Tầng 1 cho phép.
- **Tầng 3 (Risk/Sizing)** — tính khối lượng, điểm dừng, kiểm R:R tối thiểu.
- **Edge** — lý do khiến xác suất nghiêng về một hướng ở thời điểm hiện tại.
- **Expectancy** — kỳ vọng lời/lệnh, tính bằng bội số R, **ròng sau chi phí**, đo qua thời gian dài. Thước đo uy tín chính của hệ thống.
- **R / R:R** — R là mức rủi ro của một lệnh (khoảng cách tới điểm dừng × khối lượng); R:R là tỷ lệ lời-tiềm-năng trên rủi ro.
- **Give-back** — chu kỳ thắng chuỗi rồi trả lại sạch lợi nhuận do overtrade/revenge trade.
- **Live-drift** — độ lệch giữa expectancy thực chiến và khoảng tin cậy của backtest.
- **Cost hurdle** — ngưỡng edge tối thiểu (theo bội số chi phí round-trip) để một lệnh được phép thành Đề xuất.
- **LLM Narrator** — thành phần LLM chỉ diễn giải lý do đằng sau một Đề xuất đã được rule quyết định; không tạo/đổi lệnh.
- **Nhật ký (Audit log)** — bản ghi bất biến mọi Đề xuất, lý do, tín hiệu kích hoạt, và mọi lần override.

## 4. Features

### 4.1 Pipeline quyết định 4 tầng
**Description:** Trái tim hệ thống. Một tín hiệu chỉ trở thành **Đề xuất** khi đi lọt từ Tầng 0 xuống Tầng 3; bất kỳ tầng nào chặn thì dừng và hệ thống **im lặng** (không đề xuất). Kiến trúc phân cấp phản ánh nguyên lý nền: FA/regime quyết *có được săn và hướng nào*, TA quyết *điểm vào*, risk quyết *khối lượng/dừng*, và hành vi phủ quyết tất cả. Realizes UJ-1, UJ-2, UJ-3.

**Functional Requirements:**

#### FR-1: Tầng 0 — Phủ quyết hành vi
Hệ thống chặn tạo Đề xuất mới khi bất kỳ luật kỷ luật nào kích hoạt.

**Consequences (testable):**
- Sau một lệnh đóng lỗ, hệ thống không phát Đề xuất mới trong khoảng `cooldown_after_loss` (mặc định `[ASSUMPTION: 30–60 phút]`).
- Khi số lệnh trong ngày đạt `max_trades_per_day`, mọi Đề xuất mới bị chặn tới hết ngày.
- Khi chuỗi thắng đạt `win_streak_threshold` (mặc định `[ASSUMPTION: 3]`), size cho phép bị nhân `size_dampening` (mặc định `[ASSUMPTION: 0.5×]`) và/hoặc ngưỡng vào lệnh bị nâng.
- Khi lỗ luỹ kế trong ngày chạm `daily_loss_limit`, hệ thống khoá tới hết ngày.
- Trong cửa sổ `news_blackout` quanh một tin FX high-impact, hệ thống chặn Đề xuất cho cặp FX liên quan.
- Mọi lần chặn được ghi vào Nhật ký kèm lý do.

#### FR-2: Tầng 1 — Regime + Edge/hướng
Hệ thống xác định chế độ thị trường và hướng edge; nếu không rõ hướng → không tín hiệu.

**Consequences (testable):**
- Với **crypto**, hệ thống tính hướng edge từ tổ hợp funding rate, open interest, long/short ratio, CVD (từ Binance) theo luật có tham số cấu hình được.
- Với **FX**, hướng edge dựa trên price action đọc vùng thanh khoản; tin tức KHÔNG dùng chọn hướng (chỉ là bộ lọc rủi ro ở Tầng 0).
- Khi tín hiệu các nguồn mâu thuẫn hoặc dưới ngưỡng, hệ thống trả "không có hướng" và dừng pipeline.

#### FR-3: Tầng 2 — Khoanh vùng điểm vào (Price Action)
Hệ thống tự khoanh vùng vào lệnh theo hướng Tầng 1 cho phép, nhưng không tự đặt lệnh.

**Consequences (testable):**
- Chỉ tìm điểm vào theo đúng hướng Tầng 1; không đề xuất ngược hướng.
- Nếu không có setup đạt chuẩn, hệ thống chờ (không ép ra Đề xuất).
- Vùng vào lệnh xuất ra ở dạng người dùng đọc và xác nhận được.

#### FR-4: Tầng 3 — Risk/Sizing (deterministic)
Hệ thống tính khối lượng, điểm dừng, và kiểm R:R tối thiểu một cách tất định.

**Consequences (testable):**
- Khối lượng tính từ `% rủi ro cố định` trên vốn (mặc định `[ASSUMPTION: 1%/lệnh]`) và khoảng cách tới điểm dừng.
- Điểm dừng đặt theo cấu trúc giá (vùng thanh khoản), không tuỳ hứng.
- Nếu R:R < `min_rr` (mặc định `[ASSUMPTION: 1.5–2.0]`), Đề xuất bị huỷ.
- Cùng một input luôn cho cùng một output (tất định, tái lập được).

**Feature-specific NFRs:**
- Tầng 0 và Tầng 3 phải **tất định 100%** (không dùng AI/LLM); tái lập được để backtest.

### 4.2 Nguồn dữ liệu
**Description:** Cấp dữ liệu real-time và lịch sử cho pipeline. v1 dựa chủ yếu vào Binance API (miễn phí) cho crypto, cộng một nguồn lịch kinh tế cho blackout tin FX.

**Functional Requirements:**

#### FR-5: Thu thập dữ liệu crypto từ Binance (free)
Hệ thống lấy nến, order book/trades (→ CVD), funding rate, open interest, long/short ratio, mark/index (→ basis) từ Binance API.

**Consequences (testable):**
- Có luồng real-time (WebSocket) cho dữ liệu giá và một cơ chế lấy lịch sử (REST) cho backtest.
- Khi một endpoint lỗi/timeout, hệ thống suy giảm mềm mại và ghi log, không phát Đề xuất dựa trên dữ liệu thiếu.

#### FR-6: Lịch kinh tế FX
Hệ thống nạp lịch tin high-impact (nguồn `[ASSUMPTION: ForexFactory/investing feed]`) để cấp cho blackout Tầng 0 (FR-1).

**Consequences (testable):**
- Các sự kiện high-impact (NFP, CPI, FOMC, quyết định lãi suất) được nhận diện và gắn cửa sổ blackout.

### 4.3 LLM Narrator — diễn giải
**Description:** Sau khi rule đã cho ra một Đề xuất, LLM viết cái *"tại sao"* bằng tiếng người, dùng chính các tín hiệu đã kích hoạt. Đây là thứ xây niềm tin để người dùng chịu bấm và là nhật ký để review. LLM **không bao giờ** được tạo, đổi hướng, hay bỏ qua một Đề xuất. Realizes UJ-1.

**Functional Requirements:**

#### FR-7: Sinh lý do cho Đề xuất
Hệ thống sinh một đoạn giải thích ngắn cho mỗi Đề xuất, dựa trên các tín hiệu rule đã kích hoạt.

**Consequences (testable):**
- Lời giải thích chỉ tham chiếu các tín hiệu/điều kiện đã thực sự kích hoạt Đề xuất.
- LLM chạy ở nhiệt độ thấp; mọi prompt và response được ghi vào Nhật ký.
- Nếu LLM lỗi/không phản hồi, Đề xuất vẫn hiển thị (kèm ghi chú thiếu lý do) — LLM không phải điểm chặn.

**Feature-specific NFRs:**
- LLM chỉ có vai đọc/diễn giải; không nằm trên đường quyết định vào lệnh.

### 4.4 Backtest & Expectancy trung thực
**Description:** Điều kiện tiên quyết của cả sản phẩm — không có nó, người dùng không thể *tin*, và hệ thống vô dụng. Backtest chạy toàn pipeline trên dữ liệu lịch sử và đo expectancy ròng, với kỷ luật chống overfit. Realizes UJ-4 (cung cấp baseline để đối chiếu live).

**Functional Requirements:**

#### FR-8: Backtest toàn pipeline với chi phí thật
Hệ thống chạy pipeline trên dữ liệu lịch sử và xuất các chỉ số hiệu năng ròng.

**Consequences (testable):**
- Backtest cộng phí + spread + slippage + funding cost khi giữ lệnh crypto.
- Xuất **expectancy ròng (bội số R)**, **max drawdown**, phân phối R-multiple, đường equity.
- Win rate chỉ hiển thị tham khảo, không phải chỉ số uy tín chính.

#### FR-9: Kỷ luật chống overfit
Hệ thống bắt buộc quy trình xác thực ngoài mẫu.

**Consequences (testable):**
- Hỗ trợ walk-forward và giữ một khối dữ liệu **holdout** không tối ưu trên đó.
- Xuất **khoảng tin cậy** của expectancy (Monte Carlo / xáo thứ tự lệnh), không chỉ một con số.
- Có chế độ forward paper-trade trước khi cho phép dùng vốn thật.
- `[ASSUMPTION]` đặt trần số tham số cấu hình được để hạn chế overfit.

### 4.5 Lá chắn Anti-fragility
**Description:** Ba lá chắn phát sinh từ Reverse Brainstorming, bảo vệ chính cơ chế niềm tin khỏi bị một expectancy giả đánh lừa. Realizes UJ-3, UJ-4.

**Functional Requirements:**

#### FR-10: Live-drift auto-halt (cái phanh cho cái phanh)
Hệ thống tự giảm rủi ro khi hiệu năng thực chiến lệch xấu khỏi kỳ vọng backtest.

**Consequences (testable):**
- Hệ thống theo dõi **Live-drift** như một chỉ số hạng nhất, hiển thị thường trực.
- Khi expectancy thực chiến trượt xuống dưới khoảng tin cậy của backtest, hệ thống tự động giảm size hoặc tạm dừng phát Đề xuất và báo lý do.

#### FR-11: Cost hurdle
Hệ thống loại các lệnh "tàng tàng" không vượt nổi chi phí.

**Consequences (testable):**
- Một tín hiệu chỉ thành Đề xuất nếu edge kỳ vọng vượt ít nhất `X×` phí round-trip (`X` cấu hình được).
- Hệ thống theo dõi tỷ lệ phí / tổng lãi gộp; vượt ngưỡng → cờ đỏ overtrade.

#### FR-12: Ma sát override
Hệ thống cho phép override nhưng đặt ma sát rẻ lên nó để bảo vệ cam kết kỷ luật của người dùng.

**Consequences (testable):**
- Override một chặn của Tầng 0 đòi một cooldown ngắn + xác nhận gõ tay.
- Mọi override được ghi vào Nhật ký (thời điểm, luật bị vượt, lý do).

### 4.6 Đề xuất & Nhật ký
**Description:** Bề mặt output và bản ghi audit. Hệ thống trình Đề xuất cho người dùng xác nhận, và ghi lại mọi thứ để review. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-13: Trình Đề xuất để xác nhận (auto-suggest, không auto-execute)
Hệ thống hiển thị Đề xuất đầy đủ và chờ người dùng xác nhận; không tự đặt lệnh.

**Consequences (testable):**
- Đề xuất gồm: hướng, khối lượng, điểm dừng, target/R:R, và lý do (LLM).
- Khi không có Đề xuất, hệ thống hiển thị trạng thái "chờ / không có edge".
- Hệ thống không có đường dẫn nào tự gửi lệnh tới sàn trong v1.

#### FR-14: Nhật ký audit bất biến
Hệ thống ghi lại mọi Đề xuất, tín hiệu kích hoạt, lý do LLM, lần chặn, và lần override.

**Consequences (testable):**
- Bản ghi cho phép người dùng review lại vì sao một Đề xuất xuất hiện (hoặc bị chặn).
- Nhật ký override cho người dùng thấy sự thật về hành vi của chính mình khi review.

## 5. Non-Goals (Explicit)
- **Không** tự động đặt lệnh (full auto execution) trong v1.
- **Không** dùng ML dự đoán giá — chỉ dùng rule (quyết định) + LLM (diễn giải).
- **Không** trở thành công cụ quản lý danh mục / phân bổ tài sản.
- **Không** đa người dùng / SaaS trong v1.
- **Không** hứa hẹn "win rate cao" như một chỉ số marketing — uy tín đo bằng expectancy ròng.
- **Không** tính thuế / kế toán giao dịch.

## 6. MVP Scope

### 6.1 In Scope
- Pipeline 4 tầng (FR-1..FR-4).
- Nguồn dữ liệu Binance free + lịch tin FX (FR-5, FR-6).
- LLM Narrator diễn giải (FR-7).
- Backtest & expectancy trung thực + chống overfit (FR-8, FR-9).
- Ba lá chắn anti-fragility (FR-10, FR-11, FR-12).
- Đề xuất + xác nhận + nhật ký audit (FR-13, FR-14).

### 6.2 Out of Scope for MVP
- Liquidation heatmap đầy đủ (Coinglass/Hyblock) — trả phí, để **v2**. `[NOTE FOR PM: đây là "bản đồ thanh khoản" mạnh nhất — revisit khi đã tin hệ thống.]`
- On-chain / exchange flow (Glassnode/CryptoQuant) — **v2**.
- LLM vai "đọc tin → tag cấu trúc" và "veto một chiều" — **v2** (v1 chỉ giữ vai diễn giải).
- Tự động đặt lệnh — **không làm** (xem Non-Goals).

## 7. Success Metrics

**Primary**
- **SM-1**: **Expectancy ròng thực chiến dương**, đo bằng bội số R sau chi phí qua một cửa sổ đủ dài `[ASSUMPTION: ≥ 3 tháng / ≥ 100 lệnh]`. Validates FR-8, FR-9.
- **SM-2**: **Max drawdown thực chiến ≤ ngưỡng** `[ASSUMPTION: 12–15%]`. Validates FR-1, FR-4, FR-10.

**Secondary**
- **SM-3**: **Live-drift nằm trong khoảng tin cậy backtest** phần lớn thời gian; auto-halt kích hoạt đúng khi lệch. Validates FR-10.
- **SM-4**: **Tỷ lệ tuân theo** — người dùng hành động khớp với Đề xuất/chặn của hệ thống ở mức cao; số lần override thấp và có xu hướng giảm. Validates FR-12, FR-14.
- **SM-5**: **Give-back giảm** — lợi nhuận đỉnh không bị trả lại quá `[ASSUMPTION: X%]` sau chuỗi thắng. Validates FR-1.

**Counter-metrics (không tối ưu)**
- **SM-C1**: **Số lượng Đề xuất/lệnh** — KHÔNG tối ưu cho nhiều tín hiệu hơn; nhiều lệnh thường là overtrade. Counterbalances xu hướng "làm hệ thống nhạy hơn".
- **SM-C2**: **Win rate** — KHÔNG dùng làm mục tiêu; tối ưu win rate dẫn thẳng tới bẫy give-back. Counterbalances SM-1 bị hiểu sai.

## 8. Open Questions
1. Ngưỡng cụ thể cho các tham số Tầng 0 (cooldown, max_trades/day, win_streak, daily_loss_limit) — cần backtest để chốt.
2. Định nghĩa "regime" và cách phân loại trending vs sideway ở Tầng 1 (rule gì, khung thời gian nào?).
3. Luật `if/then` con số cụ thể cho Tầng 1 crypto (funding/OI/L-S/CVD) — chưa chưng thành ngưỡng.
4. **Vercel serverless & real-time:** Next.js trên Vercel chạy serverless — cần chốt cách duy trì luồng WebSocket/real-time cho FR-5 (worker riêng, service ngoài, hay polling định kỳ?). Đây là ràng buộc kiến trúc cần giải ở `bmad-architecture`.
5. Cơ chế thông báo Đề xuất real-time (web push, âm thanh, màn hình?).
6. Nguồn lịch tin FX cụ thể và cách lấy (API trả phí hay scrape?).
7. Giá trị `X` cho cost hurdle và cách ước lượng slippage thực tế cho backtest.

## 9. Assumptions Index
- §0/§11 — Form-factor v1: **web app Next.js host trên Vercel** (đã xác nhận).
- §4.1 FR-1 — cooldown 30–60 phút; win_streak_threshold=3; size_dampening=0.5×.
- §4.1 FR-4 — % rủi ro cố định 1%/lệnh; min_rr 1.5–2.0.
- §4.2 FR-6 — nguồn lịch tin FX là ForexFactory/investing.
- §4.4 FR-9 — có trần số tham số cấu hình để hạn chế overfit.
- §7 — SM cửa sổ đo ≥ 3 tháng / ≥ 100 lệnh; max DD 12–15%; ngưỡng give-back X%.

---

## 10. Cross-Cutting NFRs
- **Tất định & tái lập:** lõi rule (Tầng 0, Tầng 3, cost hurdle, sizing) phải cho cùng output với cùng input, để backtest đáng tin.
- **Khả kiểm (auditability):** mọi Đề xuất, tín hiệu, lý do LLM, chặn, override đều được ghi bất biến (FR-14).
- **An toàn LLM:** LLM chạy nhiệt độ thấp, mọi prompt/response được log; LLM không nằm trên đường quyết định.
- **Độ trễ:** với tín hiệu real-time, pipeline phải chạy đủ nhanh để Đề xuất còn kịp thời `[ASSUMPTION: định lượng sau theo khung thời gian trade]`.
- **Bền dữ liệu:** khi nguồn dữ liệu lỗi/thiếu, hệ thống không phát Đề xuất dựa trên dữ liệu khuyết và ghi log.

## 11. Constraints & Guardrails
- **Nền tảng:** web app **Next.js host trên Vercel**. Lưu ý: môi trường serverless của Vercel không hợp cho tiến trình chạy dài (WebSocket real-time, backtest nặng) — cần tách các phần này ra worker/service riêng (giải ở kiến trúc).
- **An toàn tài chính (Safety):** v1 tuyệt đối không có đường tự gửi lệnh tới sàn — người dùng luôn xác nhận thủ công. Đây là ràng buộc cứng, không phải tuỳ chọn.
- **Chi phí (Cost):** v1 ưu tiên nguồn dữ liệu miễn phí (Binance free); các nguồn trả phí (heatmap, on-chain) hoãn sang v2. Chi phí API LLM giữ thấp (chỉ diễn giải, nhiệt độ thấp).
- **Phạm vi khoá API sàn:** khoá API Binance dùng cho v1 `[ASSUMPTION: chỉ quyền đọc dữ liệu; nếu về sau đọc số dư/vị thế để tính size thì vẫn không cấp quyền đặt lệnh]`.
