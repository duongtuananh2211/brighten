# Epic 3: Vận hành Live + Đóng vòng

Bật hệ thống chạy thật (paper→live): scheduled tick ~1' poll dữ liệu, giữ behavioral state bền, tự theo dõi live-drift & auto-halt, đóng vòng kết quả lệnh, ma sát override, ghi nhật ký bất biến.

## Story 3.1: Live tick — cron-runner (FR-5 live)

As a người dùng,
I want pipeline tự chạy mỗi ~1 phút trên dữ liệu mới,
So that hệ thống theo thị trường 24/7 mà không cần tôi bấm.

**Acceptance Criteria:**

**Given** `pg_cron` lịch ~1' + `pg_net` gọi Edge Function (Deno) chạy `decision-core`
**When** một tick chạy
**Then** adapter poll Binance REST snapshot → pipeline chạy → ghi Đề xuất/state vào Postgres
**And** Edge Function KHÔNG cài lại luật quyết định (import cùng core, AD-3)
**And** dữ liệu thiếu ở một tick → không phát Đề xuất trên dữ liệu khuyết + log (NFR-5)

## Story 3.2: Behavioral state bền + một chủ sở hữu (AD-6)

As a người dùng,
I want state kỷ luật được lưu bền và chỉ đổi qua event định nghĩa sẵn,
So that Tầng 0 không veto sai vì state bị nhiều nơi sửa.

**Acceptance Criteria:**

**Given** behavioral state (win-streak, daily-loss, cooldown, trade-count) trong Postgres
**When** hệ thống chạy
**Then** state chỉ đổi qua đúng 2 event: `market-tick` (cron) và `trade-outcome` (feedback)
**And** UI và mọi component khác chỉ ĐỌC state, không mutate
**And** state sống sót qua restart của edge function (không giữ trong RAM)

## Story 3.3: Nhật ký audit append-only (FR-14)

As a người dùng,
I want mọi Đề xuất/chặn/override/lý do được ghi bất biến,
So that tôi review lại được vì sao và đối chiếu hành vi của chính mình.

**Acceptance Criteria:**

**Given** một Đề xuất phát ra hoặc bị chặn
**When** ghi Nhật ký
**Then** bản ghi gồm Đề xuất, tín hiệu kích hoạt, (prompt/response LLM nếu có), lần chặn, lần override — append-only
**And** không có đường UPDATE/DELETE lên bản ghi Nhật ký (AD-8)
**And** mỗi bản ghi đủ để tái dựng vì sao một Đề xuất xuất hiện hoặc bị chặn

## Story 3.4: Feedback loop hybrid — đóng vòng kết quả lệnh (AD-7)

As a người dùng không để hệ thống tự đặt lệnh,
I want hệ thống biết kết quả lệnh của tôi qua API read-only + xác nhận tay,
So that Tầng 0 và live-drift chạy trên số liệu thật.

**Acceptance Criteria:**

**Given** khóa Binance chỉ-đọc
**When** hệ thống dò tài khoản
**Then** phát hiện vị thế/fill/PnL cho `daily-loss` & `live-drift` (khóa không bao giờ có quyền đặt lệnh)
**And** user xác nhận fill nào ứng Đề xuất nào để gắn đúng `win-streak`/R
**And** kết quả sinh một event `trade-outcome` cập nhật behavioral state (nối AD-6)

## Story 3.5: Live-drift auto-halt (FR-10)

As a người dùng,
I want hệ thống tự nghi ngờ chính nó khi thực chiến lệch xấu khỏi backtest,
So that nó tự phanh khi regime đổi thay vì tiếp tục đẩy tôi vào lệnh.

**Acceptance Criteria:**

**Given** một baseline khoảng tin cậy expectancy từ backtest
**When** expectancy thực chiến trượt xuống dưới khoảng tin cậy đó
**Then** hệ thống tự giảm size hoặc tạm dừng phát Đề xuất và báo lý do
**And** Live-drift là chỉ số hạng nhất, luôn được tính và lưu (để Epic 4 hiển thị)

## Story 3.6: Ma sát override (FR-12)

As a người dùng đôi lúc muốn vượt luật,
I want override phải trả một cái giá rẻ nhưng có thật,
So that tôi bảo vệ chính cam kết kỷ luật của mình.

**Acceptance Criteria:**

**Given** một chặn của Tầng 0
**When** tôi muốn override
**Then** hệ thống bắt qua một cooldown ngắn + xác nhận gõ tay
**And** mọi override được ghi Nhật ký (thời điểm, luật bị vượt, lý do) (nối FR-14)

---
