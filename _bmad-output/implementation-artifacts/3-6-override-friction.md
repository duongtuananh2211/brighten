---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 3-5-live-drift-auto-halt
---

# Story 3.6: Ma sát override (FR-12)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng đôi lúc muốn vượt luật kỷ luật**,
I want **khi Tầng 0 chặn, muốn override phải trả một cái giá RẺ NHƯNG CÓ THẬT: một cooldown ngắn + xác nhận GÕ TAY đúng tên luật; sau ma sát mới có "grant" tạm bỏ đúng luật đó trong cửa sổ ngắn; và MỌI override ghi Nhật ký bất biến (thời điểm, luật bị vượt, lý do)**,
so that **tôi bảo vệ chính cam kết kỷ luật của mình — vượt luật không phải một-cú-click, và tôi tự đối chiếu được mình đã override bao nhiêu lần (FR-12, nối FR-14, AD-5, AD-8)**.

## Acceptance Criteria

**AC1 — Override có MA SÁT: cooldown ngắn + xác nhận gõ tay (build grant thuần)**
**Given** một luật Tầng 0 vừa chặn (code: `cooldown_active`/`daily_loss_limit_reached`/`max_trades_reached`/`news_blackout_active`/`live_drift_halt`) và user muốn vượt
**When** yêu cầu override
**Then** hàm thuần `buildOverrideGrant(input) → Result<OverrideGrant>` (`packages/decision-core/tiers/tier0/override.ts`) áp **hai ma sát**:
  - **xác nhận gõ tay**: `input.typedConfirmation` phải **khớp `ruleCode`** (gõ đúng tên luật đang vượt — có chủ đích); rỗng/sai ⇒ reject `override_confirmation_mismatch` (`source: "tier0.override"`)
  - **cooldown ngắn**: `activeFromEpochMillis = requestedAtEpochMillis + override_cooldown_ms` (grant **chưa** hiệu lực ngay — buộc chờ, phá cơn bốc đồng); `expiresAtEpochMillis = activeFrom + override_ttl_ms`
**And** `OverrideGrant = { ruleCode: string; reason: string; requestedAtEpochMillis; activeFromEpochMillis; expiresAtEpochMillis }`; hàm **thuần** (không `Date`/IO; thời gian là input); `reason` bắt buộc non-empty (ghi Nhật ký)

**AC2 — Tầng 0 tôn trọng grant ĐANG hiệu lực: bỏ ĐÚNG luật bị vượt, luật khác vẫn chặn (AD-5)**
**Given** `ctx.overrideGrants?: readonly OverrideGrant[]` (driver bơm — AC4) + `ctx.nowEpochMillis`
**When** Tầng 0 đánh giá
**Then** hàm thuần `isOverrideActive(grants, ruleCode, now) → boolean` = ∃ grant `ruleCode` khớp **và** `activeFrom <= now < expiresAt`; `evaluateBehavioralVeto` (1.6) + luật `live_drift_halt` (3.5) refactor: khi một luật **định chặn**, nếu `isOverrideActive(code)` ⇒ **bỏ qua luật đó, tiếp tục kiểm luật kế** (không block vì nó)
**And** override **theo từng luật**: vượt `cooldown_active` **không** vượt `daily_loss_limit_reached` — nếu cả hai bật mà chỉ override cooldown ⇒ Tầng 0 vẫn veto `daily_loss_limit_reached`
**And** `overrideGrants` undefined/rỗng/hết hạn ⇒ nhánh Tầng 0 **cũ nguyên** (mọi test 1.6/3.5 xanh); grant **chưa tới `activeFrom`** (còn trong cooldown) ⇒ **chưa** bỏ luật (ma sát cooldown thật sự chặn)

**AC3 — MỌI override ghi Nhật ký bất biến (nối FR-14/AD-8)**
**Given** một override được cấp (qua ma sát) hoặc áp dụng
**When** ghi Nhật ký
**Then** builder thuần `buildOverrideRecordedEvent({ grant, atEpochMillis }) → AuditEvent` `type: "override-recorded"` (3.3 đã reserve) — payload gồm **thời điểm** (requestedAt/activeFrom), **luật bị vượt** (`ruleCode`), **lý do** (`reason`), `typedConfirmation` (bằng chứng đã gõ tay); append-only (3.3)
**And** override ghi **lúc cấp grant** (request) — đây là "mọi override được ghi Nhật ký (thời điểm, luật bị vượt, lý do)"; bản ghi bất biến ⇒ user tự đối chiếu "đã override bao nhiêu lần, luật nào"

**AC4 — Driver: `requestOverride` (ma sát + persist + audit) + Tầng 0 đọc grants (AD-8, AD-6)**
**Given** `PersistencePort` + Tầng 0 + audit (3.1–3.5)
**When** user request override / mỗi tick
**Then** driver `requestOverride(deps, { ruleCode, reason, typedConfirmation }) → Result<OverrideGrant>`: `readConfigSnapshot` (cooldown/ttl) → `buildOverrideGrant(..., now)` → reject ⇒ trả lỗi (chưa persist); ok ⇒ `recordOverrideGrant(grant, typedConfirmation)` (bảng `override_grants`, append-only) → `appendAuditEvent(buildOverrideRecordedEvent)` → trả grant
**And** `runTick` (trước pipeline): `readActiveOverrideGrants(now)` → `base.overrideGrants = grants` ⇒ Tầng 0 tôn trọng; lỗi đọc grants ⇒ soft-degrade (`overrideGrants` undefined ⇒ **không** bỏ luật — mặc định AN TOÀN: hụt dữ liệu override ⇒ kỷ luật vẫn chặn)
**And** **UI của override là epic 4** (nút + ô gõ tay); 3.6 cấp backend `requestOverride` + endpoint Edge Function; **không** đường bỏ-luật nào khác ngoài grant qua ma sát (AD-6: một đường)

**AC5 — Config/port/types additive + Migration + Test + toolchain sạch**
**Given** `ConfigParams` + `PersistencePort` + `TierContext` + Postgres + `AuditEventType`
**When** mở rộng
**Then** additive: `ConfigParams` +`override_cooldown_ms` (int ≥ 0), +`override_ttl_ms` (int ≥ 1) + `DEFAULT_PARAMS` + `fieldNames` + validate + mọi fixture literal; `PersistencePort` +`recordOverrideGrant`/`readActiveOverrideGrants`; `TierContext` +`overrideGrants?`; `AuditEventType` đã có `override-recorded` (3.3) — chỉ dùng; migration `override_grants` (append-only)
**And** test cho: `buildOverrideGrant` (typedConfirmation khớp/sai; activeFrom=requested+cooldown; expires=active+ttl; reason rỗng ⇒ reject); `isOverrideActive` (biên `activeFrom<=now<expiresAt`; chưa tới activeFrom ⇒ false; hết hạn ⇒ false; sai ruleCode ⇒ false); Tầng 0 bỏ đúng luật bị override + luật khác vẫn chặn + cooldown-chưa-active vẫn chặn + undefined ⇒ cũ nguyên; `requestOverride` (mismatch ⇒ lỗi không persist; ok ⇒ persist+audit); `runTick` đọc grants→ctx; adapter 2 method; tất định/không leak
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` KHÔNG lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — Helper thuần override (AC: #1, #2)**
  - [ ] `packages/decision-core/tiers/tier0/override.ts`: **NEW** —
    - `OverrideGrant` type (như AC1)
    - `buildOverrideGrant(input: { ruleCode: string; reason: string; typedConfirmation: string; requestedAtEpochMillis: number; cooldownMs: number; ttlMs: number }): Result<OverrideGrant>` — validate `typedConfirmation === ruleCode` (khớp; documented friction) + `reason` non-empty; else reject `{code:"override_confirmation_mismatch"|"override_reason_required", source:"tier0.override", context}`; tính activeFrom/expiresAt
    - `isOverrideActive(grants: readonly OverrideGrant[], ruleCode: string, nowEpochMillis: number): boolean`
  - [ ] Thuần (không `Date`/IO); export qua `tiers/tier0/index.ts` (`export *`); `OverrideGrant` cũng export từ types nếu port cần

- [x] **Task 2 — Tầng 0 tôn trọng override (AC: #2)**
  - [ ] `packages/decision-core/pipeline/runner.ts`: `TierContext` +`readonly overrideGrants?: readonly OverrideGrant[]` (additive)
  - [ ] `packages/decision-core/tiers/tier0/behavioral-veto.ts`: `evaluateBehavioralVeto` nhận thêm `overrideGrants?`/`nowEpochMillis` (đã có now) — khi một luật (cooldown/daily-loss/max-trades/news) **định block**, `isOverrideActive(grants, code, now)` ⇒ **skip, tiếp luật kế** (không block); giữ thứ tự cố định
  - [ ] `packages/decision-core/tiers/tier0/index.ts`: truyền `ctx.overrideGrants` vào `evaluateBehavioralVeto`; luật `live_drift_halt` (3.5) cũng kiểm `isOverrideActive(grants, "live_drift_halt", now)` ⇒ skip nếu override
  - [ ] `tiers/tier0/*.test.ts`: **UPDATE** — override bỏ đúng luật; luật khác vẫn chặn; cooldown-chưa-active vẫn chặn; undefined ⇒ nhánh cũ (mọi test 1.6/3.5 xanh)

- [x] **Task 3 — Config additive + fixtures (AC: #5)**
  - [ ] `packages/config/src/schema.ts`: +`override_cooldown_ms: number` (int ≥ 0, `isNonNegativeInteger`), +`override_ttl_ms: number` (int ≥ 1, `isPositiveInteger`) vào `ConfigParams`/`DEFAULT_PARAMS` (`override_cooldown_ms: 60_000` = 1', `override_ttl_ms: 300_000` = 5')/`fieldNames`/validate
  - [ ] `schema.test.ts` + mọi literal `ConfigParams` fixture (+2 field); apps `{...DEFAULT_PARAMS}` tự đúng

- [x] **Task 4 — Persistence + audit builder (AC: #3, #4)**
  - [ ] `packages/decision-core/ports/persistence.ts`: +`recordOverrideGrant(input: { grant: OverrideGrant; typedConfirmation: string }) => Promise<Result<void>>`, +`readActiveOverrideGrants(nowEpochMillis: number) => Promise<Result<readonly OverrideGrant[]>>` (additive)
  - [ ] `packages/decision-core/audit/build.ts`: +`buildOverrideRecordedEvent({ grant, typedConfirmation, atEpochMillis }): AuditEvent` (`type:"override-recorded"`, payload thời điểm/ruleCode/reason/typedConfirmation). `AuditEventType` đã có `override-recorded` (3.3)
  - [ ] `packages/adapters/postgres/index.ts`: impl 2 method — `insert into override_grants(...)`; `select ... from override_grants where active_from <= $1 and expires_at > $1`; lỗi ⇒ `Result{ok:false}`
  - [ ] tests adapter + audit builder

- [x] **Task 5 — `requestOverride` driver + wire `runTick` (AC: #4)**
  - [ ] `apps/cron-runner/src/override.ts`: **NEW** — `requestOverride(deps: { persistence, clock }, input): Promise<Result<OverrideGrant>>` — readConfig (cooldown/ttl) → `buildOverrideGrant(..., now)` → reject ⇒ trả lỗi; ok ⇒ `recordOverrideGrant` → `appendAuditEvent(buildOverrideRecordedEvent)` → grant. Try/catch soft-degrade
  - [ ] `apps/cron-runner/src/tick.ts`: trước pipeline `readActiveOverrideGrants(toEpochMillis)` → `base.overrideGrants = grants`; lỗi ⇒ undefined (an toàn: vẫn chặn). Giữ market-tick/audit/equity/drift/soft-degrade
  - [ ] `apps/cron-runner/functions/request-override/index.ts` (+`deno.json`): **NEW** — entrypoint mỏng nhận `{ruleCode,reason,typedConfirmation}` → `requestOverride` → JSON. (UI epic 4 gọi)
  - [ ] `override.test.ts` + `tick.test.ts` **UPDATE**

- [x] **Task 6 — Migration + Tests (AC: #3, #5)**
  - [ ] `supabase/migrations/<ts>_override.sql`: **NEW** — `override_grants (id uuid pk default gen_random_uuid(), rule_code text, reason text, typed_confirmation text, requested_at_epoch_millis bigint, active_from_epoch_millis bigint, expires_at_epoch_millis bigint, created_at timestamptz default now())`; **append-only** (trigger reject update/delete như 3.3 — override là bằng chứng); read-only grant UI
  - [ ] `packages/decision-core/tiers/tier0/override.test.ts`: **NEW** — build/isActive biên (Task 1)
  - [ ] `pnpm -r test` pass; `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 3.6 **khép Epic 3** — hiện thực **FR-12 ma sát override**. Sản phẩm là "cỗ máy ép kỷ luật", nhưng con người cần **lối thoát** — override tồn tại, **nhưng có giá**: cooldown ngắn (phá bốc đồng) + xác nhận gõ tay (có chủ đích) + **ghi Nhật ký bất biến** (đối chiếu hành vi). FR-12 **sống ở Tầng 0 + audit** (Capability Map). Override **theo từng luật**: bỏ đúng luật bị vượt, không mở toang mọi kỷ luật. Bỏ được cả `live_drift_halt` (3.5) — nhưng vẫn phải trả ma sát + ghi log.

> **Phụ thuộc:** **1.6** (Tầng 0 veto codes) + **3.5** (`live_drift_halt`) + **3.3** (audit `override-recorded` reserved; append-only) + **3.1/3.2** (persistence/tick/owner). [Source: 1-6…md; 3-5…md; 3-3…md]

### 🔑 Ma sát = cooldown + gõ tay, KHÔNG một-cú-click (bản chất FR-12)

- **Cooldown ngắn**: grant chỉ hiệu lực **sau** `override_cooldown_ms` (activeFrom = requested + cooldown). Trong cooldown, Tầng 0 **vẫn chặn** ⇒ buộc user chờ, phá cơn revenge/FOMO. "Rẻ nhưng có thật".
- **Xác nhận gõ tay**: `typedConfirmation` phải **khớp `ruleCode`** — user gõ đúng tên luật đang vượt (không default, không one-click). Vừa là ma sát vừa là bằng chứng "đã ý thức luật nào".
- Đây đúng AC gốc "bắt qua một cooldown ngắn + xác nhận gõ tay". [Source: epics.md → 3.6; prd.md#FR-12]

### 🔑 Override theo TỪNG luật + mặc định AN TOÀN khi hụt dữ liệu

- `isOverrideActive(grants, code, now)` per-rule ⇒ vượt cooldown **không** tự vượt daily-loss. `evaluateBehavioralVeto` skip **chỉ** luật được override, tiếp kiểm luật kế ⇒ luật khác vẫn chặn. Không "một grant mở mọi cửa".
- **Hụt dữ liệu override ⇒ KHÔNG bỏ luật** (fail-safe kỷ luật): `readActiveOverrideGrants` lỗi ⇒ `overrideGrants` undefined ⇒ Tầng 0 chặn như thường. An toàn nghiêng về kỷ luật (đúng triết lý). [Source: ARCHITECTURE-SPINE.md#AD-5; #AD-11]

### 🔑 Một đường bỏ-luật duy nhất (AD-6) + ghi bất biến (AD-8)

- **Đường DUY NHẤT** làm Tầng 0 bỏ một luật = một `OverrideGrant` active (qua ma sát). Không cờ ẩn, không bypass rải rác. Grant sinh **chỉ** qua `buildOverrideGrant` (ma sát) + `recordOverrideGrant`.
- **Mọi override ghi `override-recorded`** append-only (3.3) — thời điểm/luật/lý do/typed. `override_grants` table cũng append-only (bằng chứng). User review "tôi override daily-loss 3 lần tuần này" ⇒ tự đối chiếu cam kết. [Source: ARCHITECTURE-SPINE.md#AD-6, #AD-8]

### Hợp đồng đã có (PHẢI tuân) — sau 1.6/3.1–3.5

| File | Trạng thái | Story 3.6 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `packages/decision-core/tiers/tier0/behavioral-veto.ts` | veto codes cố định thứ tự (1.6) | **+`overrideGrants?` param**: skip luật bị override, tiếp luật kế | codes/thứ tự; shape block |
| `packages/decision-core/tiers/tier0/index.ts` | `createTier0` (+ live_drift_halt 3.5) | truyền grants; drift-halt cũng kiểm override | luật/thứ tự; stub; formatReason |
| `packages/decision-core/pipeline/runner.ts` | `TierContext` (+liveDrift 3.5) | **+`overrideGrants?`** (additive) | runPipeline/surface/enrich |
| `packages/config/src/schema.ts` | param tới 3.5 | **+`override_cooldown_ms`,`override_ttl_ms`** | param cũ |
| `packages/decision-core/ports/persistence.ts` | method 3.1–3.5 | **+`recordOverrideGrant`/`readActiveOverrideGrants`** | method cũ |
| `packages/decision-core/audit/build.ts` | emitted/blocked/trade-outcome (3.3/3.4) | **+`buildOverrideRecordedEvent`** | `AuditEventType` (override-recorded đã reserve) |
| `packages/adapters/postgres/index.ts` | method 3.1–3.5 | **+2 method override** | method cũ; `SqlClient` |
| `apps/cron-runner/src/tick.ts` | market-tick/audit/equity/drift | **+đọc grants→ctx** | các bước cũ; soft-degrade |
| `supabase/migrations/…` | tới 3.5 | **+`override_grants`** (append-only) | migration cũ |

[Source: packages/decision-core/tiers/tier0/*, pipeline/runner, audit/build; packages/config/src/schema; packages/adapters/postgres; apps/cron-runner/src/tick]

### Invariant kiến trúc PHẢI tuân

- **AD-5 — Tầng 0 veto tối cao:** override chỉ **bỏ đúng luật** được cấp grant; per-rule; không phá thứ tự. [Source: #AD-5]
- **AD-8 — audit append-only:** mọi override ghi `override-recorded` bất biến; `override_grants` append-only. [Source: #AD-8]
- **AD-6 — một đường:** grant qua ma sát là đường duy nhất bỏ luật; không mutate rải rác. [Source: #AD-6]
- **AD-2 — thuần & tất định:** `buildOverrideGrant`/`isOverrideActive` thuần (thời gian là input). [Source: #AD-2]
- **AD-11 — suy giảm mềm/fail-safe:** hụt grants ⇒ vẫn chặn (nghiêng kỷ luật). [Source: #AD-11]
- **AD-4 — config versioned:** `override_cooldown_ms`/`override_ttl_ms` versioned. [Source: #AD-4]
- **AD-10 — không tự đặt lệnh:** override chỉ mở Tầng 0 để Đề xuất được **hiện** (user vẫn tự vào lệnh tay); KHÔNG tự gửi lệnh. [Source: #AD-10]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **UI override** (nút "Override" + ô gõ tay + đồng hồ cooldown) — **epic 4** (FR-13). 3.6 cấp backend + endpoint.
- **Giới hạn/leo thang ma sát** (override nhiều lần ⇒ cooldown dài hơn) — v2; v1 cooldown/ttl cố định (config).
- **Chặn override một số luật tuyệt đối** (vd cấm override `daily_loss_limit`) — product decision sau; v1 cho override mọi luật Tầng 0 (có ma sát+log). Xem Cần xác nhận.
- **Override consume một-lần vs cửa-sổ-thời-gian** — v1 dùng cửa sổ (`ttl`); single-consume là tùy chọn sau.
- **Realtime khi override được tạo/hết hạn** — epic 4.

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/decision-core/
  tiers/tier0/override.ts        # NEW: buildOverrideGrant + isOverrideActive + OverrideGrant
  tiers/tier0/override.test.ts   # NEW
  tiers/tier0/behavioral-veto.ts # UPDATE: +overrideGrants (skip luật bị override)
  tiers/tier0/index.ts           # UPDATE: truyền grants; drift-halt kiểm override
  tiers/tier0/*.test.ts          # UPDATE
  pipeline/runner.ts             # UPDATE: TierContext +overrideGrants?
  audit/build.ts                 # UPDATE: +buildOverrideRecordedEvent
  ports/persistence.ts           # UPDATE: +2 method override
packages/config/src/
  schema.ts, schema.test.ts      # UPDATE: +override_cooldown_ms/override_ttl_ms
packages/adapters/postgres/
  index.ts, index.test.ts        # UPDATE: +2 method override
apps/cron-runner/src/
  override.ts, override.test.ts  # NEW: requestOverride
  tick.ts, tick.test.ts          # UPDATE: đọc grants→ctx
  functions/request-override/    # NEW: Deno entrypoint (+deno.json)
supabase/migrations/
  <ts>_override.sql              # NEW: override_grants (append-only)
# + mọi literal ConfigParams fixture: +2 field override
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed; bố cục 1.6/3.x làm khuôn]

### Project Structure Notes

- **`override.ts` ở `tiers/tier0/`** (FR-12 thuộc Tầng 0, Capability Map) — cùng chỗ `live-drift.ts` (3.5), `behavioral-veto.ts` (1.6). Luật-kỷ-luật một chỗ.
- **`evaluateBehavioralVeto` refactor**: thêm param `overrideGrants` — khi luật fire, `isOverrideActive` ⇒ **continue** (không return block). Cẩn thận giữ **thứ tự cố định** + short-circuit đúng: chỉ skip luật được override, luật kế vẫn kiểm. Test kỹ tổ hợp (cooldown override + daily-loss không override ⇒ block daily-loss).
- **`TierContext +overrideGrants?`** additive (như `liveDrift?` 3.5) ⇒ test cũ (undefined) xanh.
- **`typedConfirmation === ruleCode`** là ma sát documented; nếu muốn phrase khác (vd "OVERRIDE <rule>") chỉnh trong `buildOverrideGrant` — một chỗ.
- **Fail-safe**: `readActiveOverrideGrants` lỗi ⇒ undefined ⇒ chặn (đừng "lỗi ⇒ mở luật"). Điểm dễ sai — nghiêng kỷ luật.
- **Config +2 field** ⇒ mọi literal `ConfigParams` fixture +2; apps `{...DEFAULT_PARAMS}` tự đúng.
- **override_grants append-only** như audit (3.3) — trigger reject update/delete; chỉ insert.

### Chuẩn test

- **buildOverrideGrant**: `typedConfirmation="cooldown_active"` khớp `ruleCode` ⇒ ok, activeFrom=requested+cooldown, expires=active+ttl; `typedConfirmation="x"` ⇒ reject mismatch; reason rỗng ⇒ reject; thuần/tất định/typeof.
- **isOverrideActive**: `activeFrom<=now<expiresAt` true; `now<activeFrom` (còn cooldown) false; `now>=expiresAt` false; sai ruleCode false.
- **Tầng 0**: grant active cho `cooldown_active` + cooldown fire ⇒ **không** block cooldown, kiểm luật kế; nếu daily-loss cũng fire (không grant) ⇒ block daily-loss; grant còn trong cooldown ⇒ vẫn block; undefined ⇒ nhánh 1.6/3.5 nguyên; override `live_drift_halt` ⇒ bỏ halt.
- **requestOverride**: mismatch ⇒ Result lỗi, KHÔNG persist/audit; ok ⇒ recordOverrideGrant + appendAuditEvent gọi; readConfig lỗi ⇒ soft-degrade.
- **runTick**: fake persistence grants ⇒ `ctx.overrideGrants`; đọc lỗi ⇒ undefined + tick tiếp (vẫn chặn).
- **adapter**: `recordOverrideGrant` insert đúng; `readActiveOverrideGrants(now)` where active/expires đúng; lỗi→Result.
- Không DB/mạng thật (fake ports/`SqlClient`).

### References

- [Source: epics.md → Epic 3, Story 3.6] — AC gốc (BDD): khi Tầng 0 chặn, override phải qua cooldown ngắn + xác nhận gõ tay; mọi override ghi Nhật ký (thời điểm, luật bị vượt, lý do) (nối FR-14)
- [Source: prd.md#FR-12] — override friction: giá rẻ nhưng có thật, bảo vệ cam kết kỷ luật
- [Source: ARCHITECTURE-SPINE.md#Capability Map] — FR-12 lives in `decision-core/tiers/tier0` + audit, governed AD-5/AD-8
- [Source: ARCHITECTURE-SPINE.md#AD-5] — Tầng 0 veto tối cao; override per-rule không phá thứ tự
- [Source: ARCHITECTURE-SPINE.md#AD-8] — mọi override ghi append-only; override_grants bất biến
- [Source: ARCHITECTURE-SPINE.md#AD-6, #AD-2, #AD-4, #AD-10, #AD-11] — một đường bỏ-luật; thuần/tất định; versioned; không tự đặt lệnh; fail-safe kỷ luật
- [Source: packages/decision-core/tiers/tier0/behavioral-veto.ts] — `evaluateBehavioralVeto` codes/thứ tự (thêm override skip)
- [Source: packages/decision-core/tiers/tier0/index.ts] — `createTier0` (+drift 3.5); điểm truyền grants
- [Source: packages/decision-core/pipeline/runner.ts] — `TierContext` (+overrideGrants?)
- [Source: packages/decision-core/audit/build.ts] — `AuditEventType` `override-recorded` (3.3 reserved); +builder
- [Source: packages/adapters/postgres/index.ts] — `SqlClient` tiêm; +2 method override
- [Source: 3-3-audit-log-append-only.md] — append-only + `override-recorded` reserved; trigger reject update/delete
- [Source: 3-5-live-drift-auto-halt.md] — `live_drift_halt` (override được cả cái này)
- [Source: 1-6-tier0-behavioral-veto.md] — Tầng 0 codes/thứ tự nền

## Cần xác nhận (không chặn draft)

- **Có luật nào CẤM override tuyệt đối không?** Mặc định v1 cho override **mọi** luật Tầng 0 (có ma sát+log), gồm `daily_loss_limit` & `live_drift_halt`. Nếu anh muốn cấm cứng vài luật (vd daily-loss = phanh không thể vượt), mình thêm danh sách `non_overridable` config.
- **Ma sát gõ tay**: mặc định gõ đúng `ruleCode`. Muốn phrase mạnh hơn (vd gõ cả lý do dài tối thiểu N ký tự) không?
- **Leo thang ma sát** (override càng nhiều cooldown càng dài) — v1 cố định. Có muốn v1 đã leo thang không?

## Dev Agent Record

### Agent Model Used

Claude (deepseek-v4-pro)

### Debug Log References

### Completion Notes List

- **Task 1**: Created `override.ts` in `tiers/tier0/` with pure helpers: `buildOverrideGrant` (friction gates: typedConfirmation must match ruleCode, reason non-empty; computes activeFrom=requested+cooldown, expiresAt=active+ttl) and `isOverrideActive` (per-rule check: activeFrom <= now < expiresAt AND matching ruleCode). Exported from tier0/index.ts. Added 10 tests.
- **Task 2**: Refactored `evaluateBehavioralVeto` to accept `overrideGrants?` — each of the 4 rule block points (cooldown, daily-loss, max-trades, news) checks `isOverrideActive` before returning block; if active, skips that rule and continues. Updated `createTier0` to check override for `live_drift_halt` too and pass grants to behavioral veto. Added `overrideGrants?` to `TierContext`. All existing tier0/behavioral tests pass unchanged (undefined grants ⇒ original behavior).
- **Task 3**: Added `override_cooldown_ms` (60s, ≥0) and `override_ttl_ms` (300s, ≥1) to `ConfigParams`, `DEFAULT_PARAMS`, `fieldNames`, and validation. Updated all 9 ConfigParams literal fixtures across test files.
- **Task 4**: Added `recordOverrideGrant` and `readActiveOverrideGrants` to `PersistencePort`. Implemented in postgres adapter with parameterized queries. Built `buildOverrideRecordedEvent` (type:"override-recorded", payload with ruleCode/reason/typedConfirmation/timestamps). Updated audit/index.ts exports.
- **Task 5**: Created `requestOverride` driver: readConfig → buildOverrideGrant (friction) → reject if fail → recordOverrideGrant + appendAuditEvent → return grant. Created override.ts driver module. Wired runTick to read active override grants before pipeline and inject into context. Grants read failure ⇒ undefined (fail-safe: discipline still blocks). Created Edge Function entrypoint `functions/request-override/index.ts`.
- **Task 6**: Created migration `20260705040000_override.sql`: `override_grants` append-only table with reject trigger + read-only UI grants + config seed update. Total: 353 tests pass (up from 343). Zero regressions.

### File List

- `packages/decision-core/tiers/tier0/override.ts` (NEW)
- `packages/decision-core/tiers/tier0/override.test.ts` (NEW)
- `packages/decision-core/tiers/tier0/behavioral-veto.ts` (MODIFIED — +overrideGrants param, skip overridden rules)
- `packages/decision-core/tiers/tier0/index.ts` (MODIFIED — +override check in drift/tier0, +exports, +import isOverrideActive)
- `packages/decision-core/tiers/tier0/*.test.ts` (MODIFIED — +2 config fields each)
- `packages/decision-core/pipeline/runner.ts` (MODIFIED — TierContext +overrideGrants?)
- `packages/config/src/schema.ts` (MODIFIED — +override_cooldown_ms, override_ttl_ms)
- `packages/decision-core/ports/persistence.ts` (MODIFIED — +2 override methods)
- `packages/decision-core/audit/build.ts` (MODIFIED — +buildOverrideRecordedEvent)
- `packages/decision-core/audit/index.ts` (MODIFIED — +export)
- `packages/adapters/postgres/index.ts` (MODIFIED — +2 override impls)
- `apps/cron-runner/src/override.ts` (NEW)
- `apps/cron-runner/src/tick.ts` (MODIFIED — +read grants→ctx + OverrideGrant import + inject into pipeline)
- `apps/cron-runner/src/tick.test.ts` (MODIFIED — +2 override stubs)
- `apps/cron-runner/src/feedback.test.ts` (MODIFIED — +2 override stubs)
- `apps/cron-runner/functions/request-override/index.ts` (NEW)
- `supabase/migrations/20260705040000_override.sql` (NEW)
- 9 config fixture files (MODIFIED — +2 fields each)

## Change Log

- 2026-07-05: Story 3.6 implementation — pure override friction helpers (typedConfirmation match + cooldown gate), tier0 per-rule override skip in behavioral-veto + live_drift_halt, TierContext +overrideGrants?, config params (cooldown/ttl), persistence + audit builder for override-recorded events, requestOverride driver, runTick grants wiring, append-only override_grants migration. Epic 3 complete. All 353 tests pass, 0 regressions.
