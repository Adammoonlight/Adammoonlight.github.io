/*
 * 薪资计算核心逻辑（纯函数，浏览器 / Node 双兼容）
 *
 * 采用「累计预扣法」：个税自 2019 年起按年综合所得累计预扣。
 *  - 累计应纳税所得额 = Σ(每月收入 - 五险一金个人部分 - 专项附加扣除 - 5000)
 *  - 累计应纳税额     = 累计应纳税所得额 × 预扣率 - 速算扣除数
 *  - 当月应预扣税额   = 累计应纳税额 - 累计已预扣税额
 * 因税率分档，逐月税额会随累计额跨档而「梯度」变化，故每月到手不同。
 */
(function (global) {
  'use strict';

  // 月基本减除费用（起征点）
  var DEFAULT_THRESHOLD = 5000;

  // 五险一金个人缴费比例（典型值，可按城市/输入调整）
  var DEFAULT_RATES = {
    pension: 0.08,        // 养老保险 8%
    medical: 0.02,        // 医疗保险 2%
    unemployment: 0.005,  // 失业保险 0.5%
    housing: 0.12          // 住房公积金 12%（5%~12% 可选）
  };

  // 个人所得税预扣率表（累计预扣法，按年综合所得）
  // [上限(含, 元), 预扣率, 速算扣除数]
  var WITHHOLD_TABLE = [
    [36000, 0.03, 0],
    [144000, 0.10, 2520],
    [300000, 0.20, 16920],
    [420000, 0.25, 31920],
    [660000, 0.30, 52920],
    [960000, 0.35, 85920],
    [Infinity, 0.45, 181920]
  ];

  // 四舍五入到分，避免浮点噪声（金额以「分」为最小单位）
  function round2(n) {
    if (!isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function num(v, def) {
    var n = (typeof v === 'number') ? v : parseFloat(v);
    return isFinite(n) ? n : def;
  }

  // 单月五险一金个人缴纳合计 = 基数 × (养老+医疗+失业+公积金)
  function socialInsuranceMonthly(base, rates) {
    rates = rates || {};
    var pension = (rates.pension != null) ? rates.pension : DEFAULT_RATES.pension;
    var medical = (rates.medical != null) ? rates.medical : DEFAULT_RATES.medical;
    var unemployment = (rates.unemployment != null) ? rates.unemployment : DEFAULT_RATES.unemployment;
    var housing = (rates.housing != null) ? rates.housing : DEFAULT_RATES.housing;
    return round2(base * (pension + medical + unemployment + housing));
  }

  // 根据累计应纳税所得额定位适用档位
  function bracketOf(cumulativeTaxable) {
    for (var i = 0; i < WITHHOLD_TABLE.length; i++) {
      if (cumulativeTaxable <= WITHHOLD_TABLE[i][0]) return WITHHOLD_TABLE[i];
    }
    return WITHHOLD_TABLE[WITHHOLD_TABLE.length - 1];
  }

  /*
   * 计算全年逐月（累计预扣法）
   * input: { monthlySalary, insuranceBase, specialDeduction, threshold, rates, months }
   * 返回: { monthly:[...], totals:{...}, socialMonthly }
   *   monthly[i]: { month, monthTax, accumulatedTax, takeHome,
   *                 accumulatedTakeHome, plusFund, accumulatedPlusFund }
   */
  function calcYear(input) {
    input = input || {};
    var salary = num(input.monthlySalary, 0);
    var base = (input.insuranceBase != null) ? num(input.insuranceBase, salary) : salary;
    var special = num(input.specialDeduction, 0);
    var threshold = (input.threshold != null) ? num(input.threshold, DEFAULT_THRESHOLD) : DEFAULT_THRESHOLD;
    var months = input.months || 12;

    var rates = input.rates || {};
    var housingRate = (rates.housing != null) ? rates.housing : DEFAULT_RATES.housing;

    var socialMonthly = socialInsuranceMonthly(base, rates);

    var accumulatedTaxable = 0;   // 累计应纳税所得额
    var accumulatedTaxPaid = 0;   // 累计已预扣税额
    var accumulatedTakeHome = 0;  // 累计到手（不含单位公积金）
    var accumulatedPlusFund = 0;  // 累计到手 + 单位公积金

    var rows = [];

    for (var m = 1; m <= months; m++) {
      // 累计应纳税所得额（可能因豁免不为负）
      accumulatedTaxable = round2(accumulatedTaxable + (salary - socialMonthly - special - threshold));
      if (accumulatedTaxable < 0) accumulatedTaxable = 0;

      var br = bracketOf(accumulatedTaxable);
      // 累计应纳税额
      var accumulatedTaxDue = round2(accumulatedTaxable * br[1] - br[2]);
      if (accumulatedTaxDue < 0) accumulatedTaxDue = 0;

      // 当月应预扣税额 = 累计应纳税额 - 累计已预扣
      var monthTax = round2(accumulatedTaxDue - accumulatedTaxPaid);
      if (monthTax < 0) monthTax = 0;
      accumulatedTaxPaid = round2(accumulatedTaxPaid + monthTax);

      // 当月到手（不含单位缴存的公积金）
      var takeHome = round2(salary - socialMonthly - monthTax);
      // 加公积金收入 = 到手 + 个人公积金 + 单位公积金（按同比例计）
      var plusFund = round2(takeHome + base * housingRate * 2);

      accumulatedTakeHome = round2(accumulatedTakeHome + takeHome);
      accumulatedPlusFund = round2(accumulatedPlusFund + plusFund);

      rows.push({
        month: m,
        monthTax: monthTax,
        accumulatedTax: accumulatedTaxPaid,
        takeHome: takeHome,
        accumulatedTakeHome: accumulatedTakeHome,
        plusFund: plusFund,
        accumulatedPlusFund: accumulatedPlusFund,
        accumulatedTaxable: accumulatedTaxable
      });
    }

    return {
      monthly: rows,
      totals: {
        tax: accumulatedTaxPaid,
        takeHome: accumulatedTakeHome,
        plusFund: accumulatedPlusFund,
        taxable: accumulatedTaxable
      },
      socialMonthly: socialMonthly
    };
  }

  var api = {
    DEFAULT_THRESHOLD: DEFAULT_THRESHOLD,
    DEFAULT_RATES: DEFAULT_RATES,
    WITHHOLD_TABLE: WITHHOLD_TABLE,
    round2: round2,
    socialInsuranceMonthly: socialInsuranceMonthly,
    bracketOf: bracketOf,
    calcYear: calcYear
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SalaryCalc = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
