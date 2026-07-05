import Decimal from "decimal.js";
Decimal.set({
    precision: 40,
    rounding: Decimal.ROUND_HALF_UP
});
export function toDecimal(value) {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) {
        throw new Error("Expected finite decimal string");
    }
    return parsed.toString();
}
export function add(left, right) {
    return decimal(left).plus(right).toString();
}
export function sub(left, right) {
    return decimal(left).minus(right).toString();
}
export function mul(left, right) {
    return decimal(left).times(right).toString();
}
export function div(left, right) {
    return decimal(left).dividedBy(right).toString();
}
export function abs(value) {
    return decimal(value).abs().toString();
}
export function cmp(left, right) {
    return decimal(left).comparedTo(right);
}
export function isPositive(value) {
    return cmp(value, "0") > 0;
}
export function toDecimalString(value) {
    return value;
}
function decimal(value) {
    return new Decimal(value);
}
//# sourceMappingURL=decimal.js.map