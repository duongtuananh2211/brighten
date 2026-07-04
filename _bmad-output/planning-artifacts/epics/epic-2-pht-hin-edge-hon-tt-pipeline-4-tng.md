# Epic 2: Phát hiện Edge — hoàn tất pipeline 4 tầng

Thêm hai tầng tìm cơ hội vào lõi để backtest chạy toàn pipeline: hệ thống tự xác định hướng edge và khoanh vùng điểm vào; người dùng đo được edge thật sau chi phí trên toàn bộ 4 tầng.

## Story 2.1: Tầng 1 crypto — Regime + Edge/hướng (FR-2 crypto)

As a người dùng trade crypto,
I want hệ thống suy ra hướng edge từ funding/OI/long-short/CVD,
So that nó chỉ săn khi xác suất nghiêng rõ một phía.

**Acceptance Criteria:**

**Given** MARKET_SNAPSHOT thô (funding, OI, long/short, taker volume)
**When** Tầng 1 crypto chạy trong core
**Then** CVD được tích luỹ từ taker volume TRONG core (AD-12), không ở adapter
**And** hướng edge suy ra từ tổ hợp funding cực trị + OI xác nhận + long/short theo luật có tham số cấu hình
**And** khi các nguồn mâu thuẫn hoặc dưới ngưỡng → trả "không có hướng" và dừng pipeline

## Story 2.2: Tầng 1 FX — hướng từ price action vùng thanh khoản (FR-2 FX)

As a người dùng trade FX,
I want hướng edge dựa trên price action đọc vùng thanh khoản,
So that tôi theo dòng smart-money chứ không đoán theo tin.

**Acceptance Criteria:**

**Given** dữ liệu giá FX
**When** Tầng 1 FX chạy
**Then** hướng suy ra từ price action / vùng thanh khoản
**And** tin tức KHÔNG được dùng để chọn hướng (chỉ là bộ lọc rủi ro ở Tầng 0)
**And** không rõ hướng → "không có hướng", dừng pipeline

## Story 2.3: Lịch tin FX → cửa sổ blackout (FR-6)

As a người dùng,
I want hệ thống nhận diện tin high-impact và gắn cửa sổ blackout,
So that Tầng 0 chặn được lệnh FX quanh tin.

**Acceptance Criteria:**

**Given** một nguồn lịch kinh tế FX
**When** nạp lịch
**Then** các sự kiện high-impact (NFP, CPI, FOMC, quyết định lãi suất) được nhận diện và gắn cửa sổ `news_blackout`
**And** cửa sổ blackout cấp cho Tầng 0 để chặn cặp FX liên quan (nối FR-1)
**And** nguồn lỗi → suy giảm mềm + log (NFR-5)

## Story 2.4: Tầng 2 — Khoanh vùng điểm vào (FR-3)

As a người dùng,
I want hệ thống tự khoanh vùng vào lệnh theo hướng Tầng 1 cho phép,
So that tôi có điểm vào rõ để xác nhận mà không tự đặt lệnh.

**Acceptance Criteria:**

**Given** một hướng do Tầng 1 xác định
**When** Tầng 2 chạy
**Then** chỉ tìm điểm vào ĐÚNG hướng Tầng 1, không đề xuất ngược hướng
**And** không có setup đạt chuẩn → chờ (không ép ra Đề xuất)
**And** vùng vào xuất ra ở dạng người dùng đọc & xác nhận được; KHÔNG tự đặt lệnh

## Story 2.5: Backtest toàn pipeline 4 tầng

As a người dùng,
I want backtest chạy đủ Tầng 0→3 end-to-end,
So that tôi đo được expectancy ròng của TOÀN pipeline, không phải từng mảnh.

**Acceptance Criteria:**

**Given** cả 4 tầng đã có trong core
**When** chạy `backtest-cli`
**Then** một Đề xuất chỉ sinh ra khi đi lọt cả Tầng 0→3; bất kỳ tầng chặn → không có lệnh (im lặng)
**And** báo cáo expectancy ròng + drawdown + R-distribution cho toàn pipeline
**And** kết quả tái lập với cùng dữ liệu + config version

---
