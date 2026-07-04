# Epic 4: Bề mặt Đề xuất + Diễn giải

Web app (Vercel, chỉ đọc) trình Đề xuất real-time kèm lý do tiếng người, hiển thị trạng thái "chờ/không-edge", live-drift thường trực và review nhật ký — người dùng đọc "tại sao" rồi tự xác nhận trên sàn.

## Story 4.1: Web app đọc + realtime (Vercel, cô lập)

As a người dùng,
I want một web app đọc trạng thái hệ thống và cập nhật real-time,
So that tôi thấy Đề xuất ngay khi có mà không lo app tự làm gì nguy hiểm.

**Acceptance Criteria:**

**Given** `apps/web` (Next.js) trên Vercel
**When** dữ liệu trong Postgres đổi
**Then** UI đọc Postgres và nhận realtime push (Supabase Realtime)
**And** UI KHÔNG chạy pipeline, KHÔNG mutate state, và không tồn tại đường code tự gửi lệnh tới sàn (AD-10, SAFETY)

## Story 4.2: Trình Đề xuất để xác nhận (FR-13)

As a người dùng,
I want thấy Đề xuất đầy đủ và trạng thái im lặng khi không có edge,
So that tôi bấm với niềm tin, hoặc yên tâm không làm gì.

**Acceptance Criteria:**

**Given** một Đề xuất trong Postgres
**When** mở app
**Then** hiển thị hướng, khối lượng, điểm dừng, target/R:R, và lý do
**And** khi không có Đề xuất → hiển thị trạng thái "chờ / không có edge"
**And** không có nút nào gửi lệnh tới sàn — người dùng tự xác nhận thủ công

## Story 4.3: LLM Narrator diễn giải (FR-7)

As a người dùng,
I want một đoạn "tại sao" bằng tiếng người cho mỗi Đề xuất,
So that tôi tin và bấm mà không dằn vặt.

**Acceptance Criteria:**

**Given** một Đề xuất đã được rule quyết định
**When** narrator (sau `narrator` port) chạy
**Then** lời giải thích chỉ tham chiếu các tín hiệu/điều kiện ĐÃ thực sự kích hoạt Đề xuất
**And** LLM chạy nhiệt độ thấp; mọi prompt/response được ghi Nhật ký
**And** LLM lỗi/không phản hồi → Đề xuất vẫn hiển thị kèm ghi chú thiếu lý do (không phải điểm chặn, AD-9)

## Story 4.4: Màn hình Live-drift + review Nhật ký (FR-10 hiển thị, FR-14 review, FR-12 surface)

As a người dùng,
I want thấy live-drift thường trực và review lại nhật ký/override,
So that tôi đối chiếu niềm tin và nhìn thẳng vào hành vi của mình.

**Acceptance Criteria:**

**Given** live-drift và Nhật ký trong Postgres
**When** mở app
**Then** live-drift hiển thị thường trực (kèm trạng thái auto-halt nếu đang kích hoạt)
**And** người dùng duyệt lại được Nhật ký Đề xuất/chặn với tín hiệu kích hoạt
**And** lịch sử override hiển thị để người dùng thấy sự thật về hành vi của chính mình
