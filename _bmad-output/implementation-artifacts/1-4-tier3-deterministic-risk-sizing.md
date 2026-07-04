---
baseline_commit: 9a0398971e5397685afda0c233c3152f6402bc20
---

# Story 1.4: Tầng 3 — Risk/Sizing tất định (FR-4)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng (solo trader) của Brighten**,
I want **hệ thống tính khối lượng lệnh, khoảng stop và R:R một cách tất định bằng số học decimal (không JS `number`)**,
so that **rủi ro mỗi lệnh cố định theo % vốn, và mọi kết quả tái lập chính xác 100% để backtest tin được — cùng input luôn cho cùng con số, không AI, không ngẫu nhiên (FR-4, NFR-6)**.

## Acceptance Criteria

**AC1 — Khối lượng = f(% rủi ro, khoảng cách stop), tính bằng decimal/string**
**Given** vốn `equity`, `risk_pct` (từ config snapshot), và một setup có `entry` + `stop` theo cấu trúc giá (đều là decimal-string)
**When** Tầng 3 tính sizing
**Then** `riskAmount = equity × (risk_pct / 100)` và `stopDistance = |entry − stop|` và `volume = riskAmount / stopDistance`
**And** **mọi** phép tính dùng thư viện decimal (số học chính xác), **KHÔNG** dùng JS `number` cho tiền/khối lượng ở bất kỳ bước nào; input & output là **decimal-string** (conventions)
**And** kết quả sizing gồm tối thiểu `{ direction, entry, stop, target, stopDistance, riskAmount, volume, rr }` — tất cả decimal-string

**AC2 — R:R < `min_rr` ⇒ Đề xuất bị huỷ với lý do ghi lại**
**Given** một setup đã tính được `rr = |target − entry| / |entry − stop|`
**When** `rr < min_rr` (so sánh **decimal**, `min_rr` từ config)
**Then** Tầng 3 **huỷ** (veto tại `tier3`) với `reason` nêu rõ `rr` thực & `min_rr` ngưỡng — lý do ghi lại được (không im lặng vô cớ)
**And** khi `rr ≥ min_rr` (kể cả **bằng đúng** ngưỡng — biên **pass**) thì Tầng 3 **pass** kèm kết quả sizing
**And** setup không hợp lệ về cấu trúc (xem AC4) cũng bị huỷ với `reason` phân biệt được với lý do R:R

**AC3 — Tất định 100%: cùng input → cùng output số học (NFR-6)**
**Given** cùng một `(equity, setup, risk_pct, min_rr)`
**When** gọi hàm sizing **nhiều lần**
**Then** output **bằng nhau tuyệt đối** đến từng chữ số (deep-equal các decimal-string) — không phụ thuộc thứ tự, không ngẫu nhiên, không AI
**And** độ chính xác + chế độ làm tròn của mọi phép chia được **cấu hình tập trung một chỗ** (một nguồn sự thật) để tái lập; không mỗi phép tính tự chọn precision
**And** hàm sizing **thuần**: không mutate input, không IO/`Date`/`Math.random` (pass `pnpm -r lint` rule tất định của `decision-core`)

**AC4 — Từ chối input phi lý với lỗi shape thống nhất**
**Given** input vi phạm ràng buộc: `equity ≤ 0`; `stopDistance = 0` (entry ≡ stop); stop/target **sai phía** theo `direction` (long cần `stop < entry < target`; short cần `target < entry < stop`); decimal-string không parse được; `risk_pct`/`min_rr` không hợp lệ
**When** Tầng 3 chạy
**Then** trả **rejection tường minh** mang mã lỗi + lý do (shape thống nhất `{ code, source, context }`), **không** trả sizing rác, **không** throw string trần
**And** không phép nào để `number` tiền lọt qua (ví dụ `NaN`/`Infinity` từ chia 0 bị chặn trước bằng kiểm decimal, không phải bằng `Number.isFinite`)

**AC5 — Test phủ từng AC + xác nhận toolchain sạch**
**Given** Vitest là test runner (Story 1.2/1.3 đã đặt nền)
**When** thêm test cho Tầng 3
**Then** có test cho: công thức volume/stopDistance/riskAmount/rr đúng trên số cụ thể; huỷ khi `rr < min_rr`; **pass tại biên** `rr == min_rr`; mỗi loại input phi lý ở AC4 → rejection đúng mã; tất định (chạy 2 lần → bằng nhau); không mutate input
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` không lọt `dist`

## Tasks / Subtasks

- [x] **Task 1 — Chốt & dựng nền số học decimal cho toàn core (QUYẾT ĐỊNH KHÓA — AC: #1, #3)**
  - [x] Chọn thư viện decimal và thêm vào `packages/decision-core/package.json` `dependencies`. **Mặc định khuyến nghị: `decimal.js`** (chính xác tuỳ ý, làm tròn cấu hình được, deterministic, không IO). Thay thế khả dĩ: `big.js` (nhỏ hơn, không có `.random`) — xem Dev Notes → Quyết định thư viện decimal. **Đây là lock-in cho MỌI số học tiền của mọi story sau (1.5 cost-hurdle, 1.8 backtest)** → nếu muốn đổi, báo trước khi dev
  - [x] `packages/decision-core/math/decimal.ts`: **NEW** — wrapper thuần cấu hình **một chỗ** precision + rounding (ví dụ `Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })`), export helper thuần: `toDecimal(s: string)`, `add/sub/mul/div/abs`, `cmp`, `isPositive`, `toDecimalString(d)`. Mọi phép chia đi qua đây (precision cố định → tái lập). KHÔNG export nguyên `Decimal` global có thể bị `.set()` lại rải rác
  - [x] Xác nhận import `decimal.js`/`big.js` **KHÔNG** bị lint `no-restricted-imports` của `decision-core` chặn (danh sách chặn chỉ gồm `fs/net/http/https/crypto/child_process/@supabase/*/@brighten/adapters` — thư viện decimal thuần không nằm trong đó; nó không làm IO). Ghi rõ đây là **dependency tính-toán thuần**, không phá AD-2 (xem Dev Notes → Ngoại lệ phụ thuộc)
  - [x] KHÔNG gọi `.random()`/`.set` lại của lib trong core (giữ determinism)

- [x] **Task 2 — Kiểu miền cho sizing + mở rộng TierContext (backward-compatible) (AC: #1, #2, #4)**
  - [x] `packages/decision-core/types/index.ts`: thêm (không phá kiểu cũ):
    - `TradeDirection = "long" | "short"`
    - `TradeCandidate` — **[PLACEHOLDER — Tầng 2 sinh ở story sau]**: `{ direction: TradeDirection; entry: string; stop: string; target: string }` (decimal-string). Nay do driver/backtest/test cấp; Tầng 2 sẽ sinh sau
    - `AccountState` — **[PLACEHOLDER — enriched khi có Binance balance adapter]**: `{ equity: string }` (decimal-string)
  - [x] `packages/decision-core/pipeline/runner.ts`: **mở rộng `TierContext`** thêm **hai trường optional** (giữ mọi test 1.3 xanh): `readonly candidate?: TradeCandidate` và `readonly account?: AccountState`. Vì optional nên tier0/1/2 stub không đổi; `runPipeline` không đổi logic. Cập nhật `PipelineBaseContext` tự động qua `Omit`
  - [x] Đánh dấu comment rõ hai trường này do **Tầng 2 (candidate)** và **feedback/persistence (equity)** cấp trong hệ đầy đủ; ở epic 1 do driver/test bơm vào

- [x] **Task 3 — Hàm sizing thuần (trái tim FR-4) (AC: #1, #2, #3, #4)**
  - [x] `packages/decision-core/tiers/tier3/sizing.ts`: **NEW** — hàm thuần
    `sizeTrade(input: SizingInput): SizingResult | SizingRejection` với:
    - `SizingInput = { equity: string; candidate: TradeCandidate; riskPct: string; minRr: string }`
    - `SizingResult = { ok: true; direction; entry; stop; target; stopDistance; riskAmount; volume; rr }` (tất cả decimal-string)
    - `SizingRejection = { ok: false; error: CoreError }` (shape `{ code, source: "tier3.sizing", context }`)
  - [x] Thứ tự tính & kiểm (dùng `math/decimal.ts` cho MỌI phép):
    1. Validate decimal-string parse được cho `equity/entry/stop/target/riskPct/minRr`; `equity > 0`, `riskPct > 0` (`< 100` đã do config đảm bảo nhưng vẫn thủ phòng), `minRr > 0` → sai ⇒ reject mã tương ứng
    2. Kiểm phía theo `direction`: long ⇒ `stop < entry` và `target > entry`; short ⇒ `stop > entry` và `target < entry`. Sai ⇒ reject `invalid_setup_side`
    3. `stopDistance = |entry − stop|`; nếu `= 0` ⇒ reject `zero_stop_distance` (chặn chia 0 **trước**, không để ra `Infinity`)
    4. `riskAmount = equity × riskPct / 100`
    5. `volume = riskAmount / stopDistance` (chia qua wrapper precision cố định)
    6. `rr = |target − entry| / stopDistance`
    7. `rr < minRr` (so sánh decimal) ⇒ reject `rr_below_min` với context `{ rr, minRr }`; ngược lại (kể cả `==`) ⇒ `SizingResult`
  - [x] Hàm **thuần**: không mutate `input`, không IO/`Date`/random. Không dùng `number` cho tiền — chỉ decimal-string vào/ra
  - [x] **KHÔNG** làm tròn theo step-size/tick-size của sàn ở đây (LOT_SIZE filter) — xem Ngoài phạm vi

- [x] **Task 4 — Nối vào Tầng 3 của pipeline (AC: #2)**
  - [x] `packages/decision-core/tiers/tier3/index.ts`: **thay** stub `createTier3Stub` bằng tier thật tuân hợp đồng `Tier` (giữ export tên ổn định nếu app khác import — kiểm `apps/*` trước khi đổi tên):
    - `run(ctx)`: nếu `ctx.candidate`/`ctx.account` vắng ⇒ **pass** (không có setup để size — biên epic 1, upstream Tầng 2 stub chưa sinh candidate; ghi chú rõ)
    - nếu có ⇒ gọi `sizeTrade({ equity: ctx.account.equity, candidate: ctx.candidate, riskPct: ctx.config.params.risk_pct, minRr: ctx.config.params.min_rr })`
    - `SizingRejection` ⇒ `{ kind: "veto", tier: "tier3", reason }` (huỷ với lý do — AC2)
    - `SizingResult` ⇒ `{ kind: "pass" }` (mang `SizingResult` sang Suggestion là **seam story sau** khi `TierOutcome`/`Suggestion` được làm giàu — xem Ngoài phạm vi; đừng nhét bừa vào chỗ chưa có)
  - [x] Giữ một factory cấu hình-được cho test nếu tiện (ví dụ `createTier3()`); cập nhật barrel `tiers/tier3/index.ts` + `decision-core/index.ts` export kiểu sizing công khai
  - [x] Kiểm không còn tham chiếu `createTier3Stub`/`tier3Stub` trong test/app (grep); nếu test 1.3 dùng nó, chuyển sang tier0/1/2 stub hoặc factory mới

- [x] **Task 5 — Tests phủ từng AC (AC: #1..#5)**
  - [x] `packages/decision-core/tiers/tier3/sizing.test.ts`:
    - **Công thức**: ví dụ số cụ thể (vd equity `"10000"`, riskPct `"1"`, entry `"100"`, stop `"95"`, target `"115"`) → assert `riskAmount="100"`, `stopDistance="5"`, `volume="20"`, `rr="3"` (dạng chuỗi chuẩn hoá)
    - **Huỷ khi rr<min**: target sát entry để `rr < min_rr` → reject `rr_below_min`, context có `rr`/`minRr`
    - **Biên pass**: dựng số để `rr == min_rr` chẵn → **pass** (không huỷ)
    - **AC4**: từng case `equity<=0`, `entry==stop`, long với `stop>entry`, short với `target>entry`, decimal-string rác → reject đúng `code`, `source="tier3.sizing"`
    - **Tất định**: gọi 2 lần → `toEqual`; assert input **không** bị mutate (`structuredClone` so sánh)
    - **Không number tiền**: assert mọi field kết quả `typeof === "string"`
  - [x] `packages/decision-core/tiers/tier3/index.test.ts` (pipeline-level, tối thiểu): tier3 veto khi `sizeTrade` reject (rr thấp); pass khi hợp lệ; pass khi thiếu candidate
  - [x] `pnpm -r test` pass; xác nhận `dist/` không chứa `*.test.*` và không chứa file test của tier3

## Dev Notes

> **Bối cảnh:** Đây là **story tầng đầu tiên có luật nghiệp vụ thật** (1.3 chỉ dựng hợp đồng + runner + stub). Tầng 3 là *cơ chế sizing tất định* — nền để cost-hurdle (1.5) và backtest expectancy (1.8) tin được. Nó cũng **chốt thư viện decimal** mà Story 1.2 cố ý hoãn tới đây. Trong epic 1, Tầng 1/2 vẫn là **stub** (không có story luật riêng) → candidate (entry/stop/target) do **driver/backtest/test** cấp, không phải Tầng 2 sinh.

### 🔑 Quyết định thư viện decimal (LOCK-IN — đọc kỹ)

Story 1.2 đã ghi: *"Việc chọn thư viện decimal cho số học để dành Story 1.4 (Tầng 3 sizing)."* Nay chốt tại đây và **mọi số học tiền sau này dùng chung**.

- **Khuyến nghị mặc định: `decimal.js`.** Lý do: chính xác tuỳ ý, `toDecimalPlaces`/rounding cấu hình được (xử lý sạch phép chia không kết thúc như `volume = riskAmount/stopDistance`), API đầy đủ (cmp, abs), deterministic, thuần (không IO). **KHÔNG** gọi `Decimal.random()` (nó dùng crypto/Math.random) — ta không cần randomness trong core.
- **Thay thế: `big.js`** — nhỏ hơn, không có `.random`. Đánh đổi: phải set `Big.DP`/`Big.RM` cho phép chia; API gọn hơn. Chọn nếu ưu tiên bundle nhỏ/bề mặt tối giản.
- **Bác bỏ:** `BigInt` tự cuộn (dễ sai scale/round tiền), và JS `number` (cấm theo convention).
- **Bất biến determinism:** cấu hình precision + rounding **một chỗ** trong `math/decimal.ts`; không component nào `.set()` lại. Đây là điều kiện để backtest tái lập (NFR-6). [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Tiền tệ; 1-2 Dev Notes → Convention tiền]

### Ngoại lệ phụ thuộc — decimal lib có phá "core phụ thuộc không gì" không?

Bảng layer nói Core phụ thuộc *"không gì (chỉ types nội bộ)"*. Ý định thật của AD-2 (và cái lint **thực sự** chặn) là **không IO/clock/random**, để giữ *thuần & tất định*. Một thư viện **decimal thuần** không làm IO, không đọc clock, không random (khi ta không gọi `.random`) → **củng cố** determinism chứ không phá. Nó KHÔNG nằm trong `no-restricted-imports`. ⇒ Cho phép, ghi rõ là *dependency tính-toán thuần*. Đây là quyết định có ý thức, không phải lách luật. [Source: eslint.config.js → decisionCoreFiles; ARCHITECTURE-SPINE.md#AD-2]

### Hợp đồng đã có từ Story 1.3 (PHẢI tuân, đọc trước khi sửa)

| Thứ | Định nghĩa hiện tại (1.3) | Story 1.4 dùng thế nào |
| --- | --- | --- |
| `Tier` | `{ id: TierId; run(ctx: TierContext): TierOutcome }` (`runner.ts`) | tier3 thật impl đúng chữ ký này |
| `TierOutcome` | `{kind:"pass"}` \| `{kind:"veto";tier;reason}` | huỷ-vì-RR/-setup = **veto** tại `"tier3"`; hợp lệ = **pass** |
| `TierContext` | `{ input, state, config, nowEpochMillis }` | **mở rộng optional** `candidate?`, `account?` (backward-compat) |
| `ConfigSnapshot` | `{ version, params: DeepReadonly<ConfigParams> }` (`@brighten/config`) | đọc `params.risk_pct`, `params.min_rr` (đều decimal-string) |
| `CoreError` | `{ code, source, context? }` (`types/index.ts`) | rejection dùng shape này, `source:"tier3.sizing"` |
| tier3 hiện tại | stub `createTier3Stub`/`tier3Stub` | **thay** bằng tier thật; kiểm app/test còn import stub không |

[Source: packages/decision-core/pipeline/runner.ts; packages/decision-core/types/index.ts; packages/decision-core/tiers/tier3/index.ts; packages/config/src/schema.ts]

### Nguồn dữ liệu vào Tầng 3 (giải toả mơ hồ — đừng để dev đoán)

Tầng 3 cần **3 nhóm** dữ liệu:
1. **`risk_pct`, `min_rr`** — từ `ctx.config.params` (config snapshot, AD-4). ✅ đã có.
2. **`equity` (vốn)** — **KHÔNG** nằm trong config (config có `risk_pct` chứ không có số dư tài khoản). Vốn là **state tài khoản thời-thực** (AD-7: Binance read-only balance → persistence → state). Ở epic 1 chưa có adapter đó → driver/test bơm qua `ctx.account.equity`. Mô hình `AccountState` là **placeholder**, làm giàu khi có balance adapter.
3. **`candidate` (entry/stop/target/direction)** — "điểm stop theo cấu trúc giá" là output của **Tầng 2** (price action). Trong epic 1 Tầng 2 là **stub** → candidate do driver/backtest/test cấp qua `ctx.candidate`. `TradeCandidate` là **placeholder** cho tới khi Tầng 2 sinh nó.

⇒ Vì thế mở rộng `TierContext` bằng hai trường **optional**: đúng chỗ, không phá 1.3, và phản ánh trung thực rằng producer của chúng ra đời sau. [Source: ARCHITECTURE-SPINE.md#AD-4, #AD-6, #AD-7; epics.md → Story 1.4 AC]

### Đặc tả số học sizing (một nguồn sự thật)

```text
riskAmount   = equity × (risk_pct / 100)
stopDistance = |entry − stop|                 # phải > 0
volume       = riskAmount / stopDistance      # chia qua precision cố định
rr           = |target − entry| / stopDistance
huỷ nếu rr < min_rr  (so sánh decimal)         # rr == min_rr ⇒ PASS (biên)
```
Kiểm phía trước khi tính (long: `stop < entry < target`; short: `target < entry < stop`). Chặn `stopDistance == 0` **trước** khi chia (không để `Infinity`/`NaN`). Mọi so sánh `<`/`≥` là **decimal compare**, không `Number(...)`.

> **Đơn vị volume:** cho hợp đồng linear/USDⓈ, `volume(base) = riskAmount(quote) / stopDistance(quote/base)`. Không quy đổi sang contract-count/step-size ở story này (deferred). Giữ decimal-string thô. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Tiền tệ/số lượng]

### Invariant kiến trúc PHẢI tuân

- **AD-2 — thuần & tất định:** sizing là hàm thuần; không `Date`/`Math.random`/IO; lint `decision-core` chặn. Cùng input → cùng output (NFR-6). [Source: ARCHITECTURE-SPINE.md#AD-2]
- **AD-4 — config snapshot:** `risk_pct`/`min_rr` đọc từ snapshot đã version, không đọc "config sống". [Source: #AD-4]
- **AD-5 — cost-hurdle là cổng TRONG Tầng 3:** FR-11 (Story 1.5) sẽ là **một cổng nữa bên trong Tầng 3**, chạy *sau* sizing. Thiết kế tier3 để 1.5 chèn cổng cost-hurdle vào cùng tầng (đừng tạo tầng thứ 5). [Source: #AD-5]
- **Money convention:** decimal/string, không JS `number`; R & R:R precision cố định. [Source: #Consistency Conventions]
- **Lỗi:** shape `{ code, source, context }`. [Source: #Consistency Conventions → Lỗi & log]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Cost hurdle / cổng chi phí (FR-11)** — **Story 1.5**, là cổng *trong* Tầng 3 chạy sau sizing. Chỉ chừa chỗ, không impl.
- **Làm tròn theo LOT_SIZE/tick-size/step-size của sàn** — cần symbol filters từ adapter; deferred tới khi có adapter Binance (1.7+). Story 1.4 trả decimal thô.
- **Mang `SizingResult` vào `Suggestion`** — `Suggestion` còn là stub (`{kind:"stub"}`); `TierOutcome` chưa mang payload trên nhánh pass. Việc chuyển sizing vào Đề xuất chốt khi entity `Suggestion` + emission được làm giàu (story sau). Đừng mở rộng `TierOutcome` bừa ở đây.
- **Nguồn `equity` thật** (Binance balance) & **producer `candidate`** (Tầng 2) — story sau; nay là placeholder + driver/test cấp.
- **Số học của Tầng 0/1** — story riêng.

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/decision-core/
  package.json                       # UPDATE: + dependency decimal (decimal.js|big.js)
  math/
    decimal.ts                       # NEW: cấu hình precision/rounding 1 chỗ + helper thuần
  types/index.ts                     # UPDATE: + TradeDirection, TradeCandidate, AccountState (placeholder)
  pipeline/runner.ts                 # UPDATE: TierContext + candidate?/account? (optional, backward-compat)
  tiers/tier3/
    sizing.ts                        # NEW: sizeTrade() + SizingInput/Result/Rejection
    sizing.test.ts                   # NEW
    index.ts                         # UPDATE: tier3 thật (bỏ stub) gọi sizeTrade
    index.test.ts                    # NEW (pipeline-level tối thiểu)
  index.ts                           # UPDATE: export kiểu sizing công khai
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed; bố cục 1.3 làm khuôn]

### Project Structure Notes

- Đặt `math/decimal.ts` ở `decision-core` (thuần) để 1.5/1.8 tái dùng — tránh mỗi tầng tự cấu hình precision (nguồn sai lệch tái lập). Nếu về sau nhiều package cần, có thể tách `packages/money` — **chưa cần** nay (chỉ core dùng).
- `sizing.ts` tách khỏi `index.ts` của tier3: hàm thuần dễ test đơn vị (đúng nơi 90% giá trị FR-4 nằm); `index.ts` chỉ là lớp nối pipeline mỏng.
- Xung đột đã biết: tier3 hiện là stub `createTier3Stub`/`tier3Stub` — **phải thay**; grep `apps/*` + test 1.3 xem còn ai import (1.3 File List có `apps/backtest-cli/src/main.ts`, `apps/cron-runner/functions/health/index.ts` dùng `PipelineResult`, khả năng không đụng tier3 stub — vẫn kiểm).

### Chuẩn test

- Vitest; mỗi AC ≥ 1 test (map ở Task 5). Ưu tiên **số cụ thể tính tay** để bắt sai công thức/precision.
- Test **tất định**: không clock/random; gọi 2 lần `toEqual`.
- Test **biên**: `rr == min_rr` phải pass (dễ sai thành `>`); `stopDistance` cực nhỏ (volume lớn — kiểm precision không tràn/không `number`).
- Kiểm **không mutate** input bằng `structuredClone`.
- Kiểm **không leak number**: `typeof field === "string"` cho mọi field tiền/tỷ lệ ở output.
- Không integration/DB (không adapter ở story này).

### References

- [Source: epics.md → Epic 1, Story 1.4] — AC gốc (BDD): volume=f(risk%,stop), decimal không JS number, rr<min_rr ⇒ huỷ có lý do, cùng input cùng output (NFR-6)
- [Source: ARCHITECTURE-SPINE.md#AD-2] — lõi thuần tất định (lint chặn IO/Date/random)
- [Source: ARCHITECTURE-SPINE.md#AD-4] — đọc tham số từ config snapshot có version
- [Source: ARCHITECTURE-SPINE.md#AD-5] — cost-hurdle (FR-11) là cổng *trong* Tầng 3 → chừa chỗ cho 1.5
- [Source: ARCHITECTURE-SPINE.md#AD-6, #AD-7] — nguồn state/equity (feedback + Binance read-only), lý do equity không nằm ở config
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — Tiền tệ (decimal/string, R:R precision cố định), Lỗi `{code,source,context}`, Determinism
- [Source: packages/config/src/schema.ts] — `ConfigParams.risk_pct`, `min_rr` (decimal-string) mà Tầng 3 tiêu thụ; `DEFAULT_PARAMS` để test
- [Source: packages/decision-core/pipeline/runner.ts] — hợp đồng `Tier`/`TierOutcome`/`TierContext` phải tuân + điểm mở rộng
- [Source: packages/decision-core/types/index.ts] — `CoreError`/`Result`/placeholder types để nối tiếp
- [Source: packages/decision-core/tiers/tier3/index.ts] — stub hiện tại phải thay
- [Source: 1-2 & 1-3 stories] — convention tiền hoãn chọn decimal lib tới 1.4; khuôn build/test split; core `import type` từ `@brighten/config`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `pnpm --store-dir /Users/tuananhduong/Library/pnpm/store/v11 add decimal.js --filter @brighten/decision-core` — thêm `decimal.js` và cập nhật lockfile.
- `pnpm --filter @brighten/decision-core test` — đỏ lần đầu do lỗi wrapper/parse trong quá trình TDD, sau đó xanh: 3 files, 25 tests.
- `pnpm --filter @brighten/decision-core typecheck`, `build`, `lint`, `test` — xanh sau khi sửa strict typing.
- `pnpm -r typecheck` — đỏ một lần do type của test table chưa widen trong project references, sau đó xanh.
- `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` — tất cả pass.
- `find packages/decision-core/dist -name '*.test.*' -print` — xác nhận rỗng sau khi xoá stale test artifacts và build lại.

### Completion Notes List

- Chốt `decimal.js` làm dependency tính toán thuần cho `decision-core`; wrapper `math/decimal.ts` cấu hình precision/rounding tập trung và chỉ expose helper decimal-string.
- Thêm domain types `TradeDirection`, `TradeCandidate`, `AccountState` và mở rộng `TierContext` bằng `candidate?`/`account?` theo hướng backward-compatible.
- Thêm `sizeTrade()` thuần cho Tier 3: validate decimal-string, reject input phi lý bằng `CoreError`, tính `stopDistance`, `riskAmount`, `volume`, `rr` bằng decimal-string, veto `rr_below_min` khi cần.
- Thay Tier 3 stub mặc định bằng tier thật `createTier3()`; giữ `createTier3Stub`/`tier3Stub` như alias tương thích, và pass khi chưa có candidate/account trong epic 1.
- Thêm unit tests cho sizing và pipeline-level tests cho tier3; phủ công thức, R:R reject/pass biên, input lỗi, determinism, non-mutation và output string.
- Không triển khai cost hurdle, exchange lot/tick rounding, hoặc payload sizing vào `Suggestion`; các phần đó giữ ngoài phạm vi story như Dev Notes yêu cầu.

### File List

- `_bmad-output/implementation-artifacts/1-4-tier3-deterministic-risk-sizing.md`
- `packages/decision-core/package.json`
- `pnpm-lock.yaml`
- `packages/decision-core/math/decimal.ts`
- `packages/decision-core/types/index.ts`
- `packages/decision-core/pipeline/runner.ts`
- `packages/decision-core/tiers/tier3/index.ts`
- `packages/decision-core/tiers/tier3/sizing.ts`
- `packages/decision-core/tiers/tier3/sizing.test.ts`
- `packages/decision-core/tiers/tier3/index.test.ts`

### Change Log

- 2026-07-04 — Implemented Story 1.4 deterministic Tier 3 risk sizing and moved story to review.
