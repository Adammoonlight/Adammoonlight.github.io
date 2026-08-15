const test = require('node:test');
const assert = require('node:assert');
const calc = require('./calc.js');

// 月薪 20000，基数 20000，公积金 12%，无专项附加，起征点 5000
const base = {
  monthlySalary: 20000,
  insuranceBase: 20000,
  specialDeduction: 0,
  threshold: 5000,
  rates: { pension: 0.08, medical: 0.02, unemployment: 0.005, housing: 0.12 }
};

test('逐月税额呈梯度：4月税应高于3月（跨档跳变）', () => {
  const r = calc.calcYear(base);
  const m3 = r.monthly[2].monthTax; // 3月
  const m4 = r.monthly[3].monthTax; // 4月
  assert.ok(m4 > m3, `4月税 ${m4} 应高于 3月税 ${m3}`);
});

test('逐月税额数值：1~3月=315，4月起跳到735', () => {
  const r = calc.calcYear(base);
  assert.strictEqual(r.monthly[0].monthTax, 315);
  assert.strictEqual(r.monthly[1].monthTax, 315);
  assert.strictEqual(r.monthly[2].monthTax, 315);
  assert.strictEqual(r.monthly[3].monthTax, 735);
});

test('全年累计税额 = 10080', () => {
  const r = calc.calcYear(base);
  assert.strictEqual(r.totals.tax, 10080);
});

test('1月当月到手 = 15185（20000-4500社保-315税）', () => {
  const r = calc.calcYear(base);
  assert.strictEqual(r.monthly[0].takeHome, 15185);
});

test('加公积金(当月) = 到手 + 2×基数×公积金比例', () => {
  const r = calc.calcYear(base);
  const m = r.monthly[0];
  const expectPlus = round2(m.takeHome + 20000 * 0.12 * 2);
  assert.strictEqual(m.plusFund, expectPlus);
});

test('累计到手 = 各月当月到手之和', () => {
  const r = calc.calcYear(base);
  const sum = r.monthly.reduce((s, m) => s + m.takeHome, 0);
  assert.strictEqual(r.totals.takeHome, sum);
});

test('累计税 = 各月当月税之和，且与末月累计税一致', () => {
  const r = calc.calcYear(base);
  const sum = r.monthly.reduce((s, m) => s + m.monthTax, 0);
  assert.strictEqual(sum, r.totals.tax);
  assert.strictEqual(r.monthly[11].accumulatedTax, r.totals.tax);
});

test('速算扣除定位：累计应税 42000 命中 10% 档（速扣2520）', () => {
  const br = calc.bracketOf(42000);
  assert.strictEqual(br[1], 0.10);
  assert.strictEqual(br[2], 2520);
});

test('边界：累计应税恰为 144000 仍命中 10% 档（其是 10% 档上限）', () => {
  // 预扣率表：超过36000至144000为10%；超过144000才进20%
  const br = calc.bracketOf(144000);
  assert.strictEqual(br[1], 0.10);
});

test('边界：累计应税 144001 命中 20% 档', () => {
  const br = calc.bracketOf(144001);
  assert.strictEqual(br[1], 0.20);
});

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
