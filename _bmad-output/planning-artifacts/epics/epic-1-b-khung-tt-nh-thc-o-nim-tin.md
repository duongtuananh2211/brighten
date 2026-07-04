# Epic 1: Bộ khung tất định + Thước đo niềm tin

Người dùng backtest được kỷ luật (Tầng 0) + sizing (Tầng 3) + cost hurdle trên dữ liệu Binance thật, thấy expectancy ròng & max drawdown — bằng chứng để tin "cái phanh". Dựng khung `decision-core` (lõi thuần) + `backtest-cli`, config versioned/snapshot, hai tầng tất định, adapter dữ liệu lịch sử, và backtest engine chi phí thật + chống overfit.

## Story 1.1: Scaffold monorepo & stack $0

As a người xây kiêm người dùng,
I want một monorepo TypeScript với đủ package/app rỗng và ràng buộc lint tất định,
So that mọi story sau có chỗ đứng đúng và lõi không thể lẫn IO ngay từ ngày đầu.

**Acceptance Criteria:**

**Given** repo trống
**When** dựng workspace (pnpm) với `packages/decision-core`, `packages/adapters`, `packages/config`, `apps/web`, `apps/cron-runner`, `apps/backtest-cli`, `supabase/migrations`
**Then** toàn repo build & typecheck pass ở TS strict
**And** lint rule chặn `Date.now()`/`Math.random()`/import IO trong `packages/decision-core` đang bật (AD-2)
**And** dự án Supabase khởi tạo được (migration rỗng chạy được) và `apps/web` deploy được lên Vercel free (trang trống)

## Story 1.2: Config có phiên bản + snapshot bất biến

As a người dùng,
I want mọi tham số điều chỉnh-được nằm trong config có version và snapshot được,
So that mỗi Đề xuất/backtest tái lập chính xác kể cả sau khi tôi tinh chỉnh tham số.

**Acceptance Criteria:**

**Given** một bộ tham số (cooldown, win_streak_threshold, size_dampening, daily_loss_limit, min_rr, risk %, cost_hurdle_X, news_blackout, trading-day boundary)
**When** lưu config
**Then** config nhận một `version` và đọc lại theo version cho đúng giá trị đã lưu (AD-4)
**And** hàm snapshot trả về một object bất biến nhúng được vào Đề xuất/BacktestRun
**And** đổi tham số tạo version mới, không ghi đè version cũ

## Story 1.3: Khung decision-core + ports + pipeline runner

As a người xây,
I want lõi thuần với các port và một pipeline runner chạy chuỗi tầng pass/veto,
So that live và backtest dùng chung một engine và lõi không chạm IO.

**Acceptance Criteria:**

**Given** các port `ingestion`, `persistence`, `narrator`, `clock`, `ui-read` được định nghĩa là interface
**When** pipeline runner chạy với các tier stub
**Then** nó gọi Tầng 0→1→2→3 đúng thứ tự và dừng ngay khi một tầng veto (AD-5)
**And** lõi lấy thời gian qua `clock` port, không gọi `Date.now()` (AD-2)
**And** cùng `(input, state, config)` luôn cho cùng output (NFR-1)

## Story 1.4: Tầng 3 — Risk/Sizing tất định (FR-4)

As a người dùng,
I want hệ thống tính khối lượng, stop và R:R một cách tất định,
So that rủi ro mỗi lệnh cố định và kết quả tái lập được để backtest.

**Acceptance Criteria:**

**Given** vốn, % rủi ro cấu hình, và một điểm stop theo cấu trúc giá
**When** Tầng 3 chạy
**Then** khối lượng = f(% rủi ro, khoảng cách stop), tính bằng decimal/string (không dùng JS `number` cho tiền)
**And** nếu `R:R < min_rr` thì Đề xuất bị huỷ với lý do ghi lại
**And** cùng input cho cùng output số học (NFR-6, tất định 100%, không AI)

## Story 1.5: Cost hurdle — cổng chi phí (FR-11)

As a người dùng,
I want loại các lệnh "tàng tàng" không vượt nổi chi phí,
So that hệ thống không đẩy tôi vào overtrade với edge mỏng.

**Acceptance Criteria:**

**Given** một edge kỳ vọng và phí round-trip ước lượng
**When** cổng cost-hurdle trong Tầng 3 chạy
**Then** tín hiệu chỉ qua nếu edge ≥ `cost_hurdle_X ×` phí round-trip (X từ config)
**And** edge dưới ngưỡng → chặn + ghi log lý do
**And** hệ thống theo dõi tỷ lệ phí/lãi gộp và bật cờ đỏ overtrade khi vượt ngưỡng

## Story 1.6: Tầng 0 — Phủ quyết hành vi (FR-1)

As a người dùng dễ overtrade sau khi thắng,
I want hệ thống chặn Đề xuất mới khi luật kỷ luật kích hoạt,
So that tôi không trả lại lợi nhuận vì give-back/revenge trade.

**Acceptance Criteria:**

**Given** một lệnh vừa đóng lỗ
**When** trong khoảng `cooldown_after_loss`
**Then** không Đề xuất mới nào được phát và lần chặn được ghi Nhật ký
**Given** số lệnh trong trading-day (mốc cấu hình, mặc định UTC 00:00) đạt `max_trades_per_day`
**When** có tín hiệu mới
**Then** Đề xuất bị chặn tới hết ngày
**Given** chuỗi thắng đạt `win_streak_threshold`
**When** tính size cho phép
**Then** size bị nhân `size_dampening` và/hoặc ngưỡng vào bị nâng
**And** khi lỗ luỹ kế ngày chạm `daily_loss_limit` → khoá tới hết ngày; trong `news_blackout` → chặn cặp FX liên quan; mọi lần chặn ghi log

## Story 1.7: Adapter dữ liệu Binance lịch sử (FR-5 lịch sử)

As a người xây,
I want lấy dữ liệu lịch sử Binance đã chuẩn hóa cho backtest,
So that engine đo được trên dữ liệu thật.

**Acceptance Criteria:**

**Given** một cặp + khung thời gian + khoảng ngày
**When** adapter `binance-rest` (lịch sử) chạy
**Then** trả klines (kèm taker buy/sell volume), funding, open interest, long/short ratio ở đúng shape `MARKET_SNAPSHOT` do adapter sở hữu
**And** adapter chỉ giao dữ liệu thô — KHÔNG tính chỉ báo (CVD/regime tính trong core, AD-12)
**And** endpoint lỗi/thiếu → suy giảm mềm + log, không trả dữ liệu khuyết như hợp lệ (NFR-5)

## Story 1.8: Backtest engine chi phí thật (FR-8)

As a người dùng,
I want chạy pipeline trên lịch sử và thấy expectancy ròng sau chi phí,
So that tôi có bằng chứng trung thực để tin hệ thống.

**Acceptance Criteria:**

**Given** `backtest-cli` bơm dữ liệu lịch sử vào cùng `decision-core` (AD-3)
**When** chạy một backtest
**Then** kết quả cộng phí + spread + slippage + funding cost (khi giữ lệnh crypto)
**And** xuất expectancy ròng (bội số R), max drawdown, phân phối R-multiple, đường equity
**And** win rate chỉ hiển thị nhãn "tham khảo", không phải chỉ số uy tín chính
**And** cùng dữ liệu + cùng config version → cùng kết quả (tái lập)

## Story 1.9: Kỷ luật chống overfit (FR-9)

As a người dùng,
I want quy trình xác thực ngoài mẫu bắt buộc,
So that expectancy không phải ảo do overfit.

**Acceptance Criteria:**

**Given** một dải dữ liệu lịch sử
**When** chạy xác thực
**Then** hỗ trợ walk-forward và giữ một khối holdout KHÔNG được tối ưu trên đó
**And** xuất khoảng tin cậy của expectancy (Monte Carlo / xáo thứ tự lệnh), không chỉ một con số
**And** có chế độ forward paper-trade (đánh dấu, không vốn thật) trước khi cho phép live
**And** số tham số cấu hình-được bị chặn trần theo config

---
