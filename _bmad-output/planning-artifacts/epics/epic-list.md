# Epic List

## Epic 1: Bộ khung tất định + Thước đo niềm tin
Người dùng backtest được kỷ luật (Tầng 0) + sizing (Tầng 3) + cost hurdle trên dữ liệu Binance thật, thấy expectancy ròng & max drawdown — bằng chứng để tin "cái phanh" trước khi đặt cược. Dựng scaffold monorepo, lõi thuần + ports + config versioned/snapshot, hai tầng tất định, adapter dữ liệu lịch sử, và backtest engine chi phí thật + chống overfit. Tất cả nằm trong `decision-core` + `backtest-cli` (dính file cao).
**FRs covered:** FR-1, FR-4, FR-5 (lịch sử), FR-8, FR-9, FR-11

## Epic 2: Phát hiện Edge — hoàn tất pipeline 4 tầng
Thêm hai tầng tìm cơ hội vào lõi để backtest chạy toàn pipeline: hệ thống tự xác định hướng edge và khoanh vùng điểm vào; người dùng đo được edge thật sau chi phí trên toàn pipeline 4 tầng.
**FRs covered:** FR-2, FR-3, FR-6

## Epic 3: Vận hành Live + Đóng vòng
Bật hệ thống chạy thật (paper→live): scheduled tick ~1' poll dữ liệu, giữ behavioral state bền, tự theo dõi live-drift và auto-halt, đóng vòng kết quả lệnh (read-only API + xác nhận), ma sát override, ghi nhật ký bất biến. "Cái phanh" hoạt động trên thị trường thật.
**FRs covered:** FR-5 (live), FR-10, FR-12, FR-14

## Epic 4: Bề mặt Đề xuất + Diễn giải
Web app (Vercel, chỉ đọc) trình Đề xuất real-time kèm lý do tiếng người (LLM narrator), hiển thị trạng thái "chờ/không-edge", live-drift thường trực và review nhật ký — người dùng đọc "tại sao" rồi tự xác nhận trên sàn.
**FRs covered:** FR-7, FR-13 (+ hiển thị FR-10/FR-12/FR-14)

---
