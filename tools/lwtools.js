/* Lockwood free tools: the math, copied line for line from the product's engine (taxdesk/proceeds.py,
   taxdesk/nexus.py, taxdesk/checks.py). Rules tables are embedded in each page at build time.
   tests/test_tools.py runs this file under Node and checks it against the Python engine on many inputs. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LW = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function graduated(amount, brackets) {
    var tax = 0;
    for (var i = 0; i < brackets.length; i++) {
      var floor = brackets[i][0], rate = brackets[i][1];
      var top = i + 1 < brackets.length ? brackets[i + 1][0] : null;
      if (amount <= floor) break;
      tax += ((top !== null ? Math.min(amount, top) : amount) - floor) * rate;
    }
    return tax;
  }

  function stateTerms(T, state) {
    var code = (state || "").toUpperCase();
    var row = T.ptet[code];
    if (!row) return { code: state, name: state || "unknown state", has_ptet: null, individual_top_rate: null, verified: false };
    var o = {}; for (var k in row) o[k] = row[k]; o.code = code; return o;
  }

  function canon(name) {
    var a = name.toLowerCase();
    var table = [["receivables", ["receivable"]], ["inventory", ["inventor"]],
      ["equipment", ["equipment", "vehicle", "fixed asset", "machinery", "furniture"]],
      ["noncompete", ["non-compete", "noncompete", "restrictive covenant", "consulting"]],
      ["goodwill", ["goodwill", "intangible", "customer list", "trade name"]]];
    for (var i = 0; i < table.length; i++) for (var j = 0; j < table[i][1].length; j++) if (a.indexOf(table[i][1][j]) >= 0) return table[i][0];
    return a.trim();
  }

  function kind(cls) {
    var a = cls.toLowerCase();
    if (a.indexOf("receivable") >= 0 || a.indexOf("inventory") >= 0) return "ordinary_asset";
    if (a.indexOf("equipment") >= 0 || a.indexOf("vehicle") >= 0 || a.indexOf("fixed") >= 0) return "depreciable";
    if (a.indexOf("non-compete") >= 0 || a.indexOf("noncompete") >= 0 || a.indexOf("consulting") >= 0) return "noncompete";
    return "capital";
  }

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* After-tax proceeds for an S corporation seller (proceeds.after_tax with entity "s_corp").
     offer: {price, asset: bool, allocation: {class: amount}, escrow, seller_note}
     basis: {stock_basis, assets: {class: {basis, depreciation}}}
     rates: optional overrides ({state: 0.05, selling_costs: 0.06}) */
  function afterTax(T, offer, basis, rates, price, ptet, state) {
    rates = rates || {};
    var r = {}; var d = T.defaults; for (var k in d) r[k] = d[k]; for (k in rates) r[k] = rates[k];
    var override = rates.state !== undefined && rates.state !== null;
    var terms = stateTerms(T, state);
    if (r.state === null || r.state === undefined) r.state = terms.individual_top_rate || 0;
    price = price === undefined || price === null ? offer.price : price;
    var costs = price * r.selling_costs;
    var ordinary = 0, capital = 0, lines = [];
    if (!offer.asset) {
      capital = price - costs - basis.stock_basis;
      lines.push("Stock sale: price less costs less stock basis is all capital gain");
    } else {
      var alloc = {}, sum = 0, gw = null;
      for (k in offer.allocation) { alloc[k] = offer.allocation[k]; sum += offer.allocation[k]; if (gw === null && canon(k) === "goodwill") gw = k; }
      gw = gw || "Goodwill";
      alloc[gw] = (alloc[gw] || 0) + (price - sum);
      for (var cls in alloc) {
        var amt = alloc[cls], b = { basis: 0, depreciation: 0 };
        for (var bk in basis.assets) if (canon(bk) === canon(cls)) { b = basis.assets[bk]; break; }
        var gain = amt - b.basis, kd = kind(cls);
        if (kd === "depreciable") {
          var o = Math.max(0, Math.min(gain, b.depreciation));
          ordinary += o; capital += gain - o;
          lines.push(cls + ": " + money(o) + " ordinary (depreciation recapture), " + money(gain - o) + " capital");
        } else if (kd === "ordinary_asset" || kd === "noncompete") {
          ordinary += gain; lines.push(cls + ": " + money(gain) + " ordinary income");
        } else {
          capital += gain; lines.push(cls + ": " + money(gain) + " capital gain");
        }
      }
      capital -= costs;
    }
    var brackets = terms.individual_brackets || terms.brackets;
    if (brackets && !override) {
      var g = Math.max(ordinary + capital, 0);
      r.state = g ? graduated(g, brackets) / g : brackets[0][1];
    }
    var cg = override ? 1 : (+terms.capital_gain_rate_factor || 1);
    var fedOrd = r.ordinary, fedCap = r.capital + r.niit;
    var stateTax = (ordinary + capital * cg) * r.state;
    var fedTax = ordinary * fedOrd + capital * fedCap;
    var ptetPaid = 0, ptetSavings = 0, canElect = !!terms.has_ptet, usedPtet = false;
    if (offer.asset && ptet && canElect) {
      usedPtet = true;
      var pcg = override ? cg : (+(has(terms, "ptet_capital_gain_rate_factor") ? terms.ptet_capital_gain_rate_factor : terms.capital_gain_rate_factor) || 1);
      var onlyOrd = terms.ptet_scope === "ordinary_only";
      var covered = onlyOrd ? Math.max(ordinary, 0) : Math.max(ordinary + capital * pcg, 0);
      var ownerPart = onlyOrd ? Math.max(ordinary, 0) : Math.max(ordinary + capital * cg, 0);
      var ptetRate;
      if (override) { ptetRate = r.state; ptetPaid = covered * ptetRate; }
      else if (terms.brackets) { ptetPaid = graduated(covered, terms.brackets); }
      else { ptetRate = terms.rate !== null && terms.rate !== undefined ? terms.rate : r.state; ptetPaid = covered * ptetRate; }
      var offOrd = Math.min(ptetPaid, Math.max(ordinary, 0));
      ptetSavings = offOrd * fedOrd + (ptetPaid - offOrd) * fedCap;
      var benefit = terms.owner_benefit || "refundable_credit";
      var pct = has(terms, "credit_pct") ? terms.credit_pct : 1;
      var ownerState;
      if (benefit === "exclusion" || benefit === "deduction") ownerState = stateTax - ownerPart * r.state;
      else {
        var credit = ptetPaid * pct, addback = benefit === "credit_with_addback" ? ptetPaid * r.state : 0;
        ownerState = stateTax + addback - credit;
        if ((benefit === "nonrefundable_credit" || benefit === "credit") && ownerState < 0) ownerState = 0;
      }
      stateTax = ptetPaid + ownerState;
      lines.push("PTET election: the company pays " + money(ptetPaid) + " of state tax, deductible federally (about " + money(ptetSavings) + " less federal tax)");
    }
    var saltBenefit = usedPtet ? 0 : Math.min(r.salt_cap_room, stateTax) * fedOrd;
    var tax = fedTax + stateTax - ptetSavings - saltBenefit;
    var net = price - costs - tax;
    return { price: price, costs: costs, ordinary_income: ordinary, capital_gain: capital, federal_tax: fedTax - ptetSavings - saltBenefit,
      state_tax: stateTax, tax: tax, after_tax: net, effective_rate: price > costs ? tax / (price - costs) : 0,
      ptet: usedPtet, ptet_paid: ptetPaid, ptet_savings: ptetSavings, state_rate: r.state, state_name: terms.name,
      state_verified: !!terms.verified, has_ptet: canElect, cash_at_close: net - (offer.escrow || 0) - (offer.seller_note || 0), lines: lines };
  }

  function grossUp(T, assetOffer, target, basis, rates, ptet, state) {
    var lo = 0, hi = assetOffer.price * 3;
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2;
      if (afterTax(T, assetOffer, basis, rates, mid, ptet, state).after_tax < target) lo = mid; else hi = mid;
    }
    return hi;
  }

  /* The calculator: the same deal as a stock sale and as an asset sale. */
  function compareStockAsset(T, deal, state) {
    var ptetOk = !!stateTerms(T, state).has_ptet;
    var basis = { stock_basis: deal.stock_basis, assets: deal.assets };
    var stock = afterTax(T, { price: deal.stock_price, asset: false, allocation: {}, escrow: deal.escrow, seller_note: deal.seller_note }, basis, deal.rates, null, false, state);
    var aOffer = { price: deal.asset_price, asset: true, allocation: deal.allocation, escrow: deal.escrow, seller_note: deal.seller_note };
    var asset = afterTax(T, aOffer, basis, deal.rates, null, ptetOk, state);
    asset.no_ptet = ptetOk ? afterTax(T, aOffer, basis, deal.rates, null, false, state).after_tax : asset.after_tax;
    var breakeven = grossUp(T, aOffer, stock.after_tax, basis, deal.rates, ptetOk, state);
    return { stock: stock, asset: asset, diff: asset.after_tax - stock.after_tax, breakeven: breakeven, ptet_available: ptetOk };
  }

  /* ---------------------------------------------------------------- nexus (taxdesk/nexus.py) */
  var NEXT_YEAR = { prior_cy: 1, prior_cy_apr: 1 }, PROXY = { rolling_12m: 1, rolling_4q: 1, ct_12m_sep30: 1 };

  function entriesForYear(R, state, year) {
    var rule = R.states[state]; if (!rule) return [];
    var jan1 = year + "-01-01", dec31 = year + "-12-31";
    return (rule.nexus_history || []).filter(function (h) {
      return (h.from || "0000-01-01") <= dec31 && (h.to || "9999-12-31") >= jan1 && (h.obligation || "collect") === "collect";
    });
  }

  function span(h) { return "rule in force " + (h.from || "start") + " to " + (h.to || "now"); }

  function crossed(R, state, year, sales, invoices) {
    var hs = entriesForYear(R, state, year);
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i], s = h.sales_threshold, t = h.transaction_threshold;
      var bySales = s !== null && s !== undefined && sales > s, byTxn = !!t && invoices >= t;
      if (h.test === "and") { if (bySales && byTxn) return [true, "sales " + money(sales) + " > " + money(s) + " and " + invoices + " transactions >= " + t + " (" + span(h) + ")", h]; continue; }
      if (bySales) return [true, "sales " + money(sales) + " > " + money(s) + " (" + span(h) + ")", h];
      if (byTxn) return [true, invoices + " transactions >= " + t + " (" + span(h) + ")", h];
    }
    return [false, "", null];
  }

  /* {year: {sales, invoices}} -> {rows: [[year, why]], start, first_cross, notes} */
  function exposureYears(R, state, byYear) {
    var rule = R.states[state] || {}, code = rule.measurement_code || "prior_or_current_cy";
    var years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
    var first = null, whyFirst = "", out = [], notes = [];
    years.forEach(function (y) { var c = crossed(R, state, y, byYear[y].sales, byYear[y].invoices); if (c[0] && first === null) { first = y; whyFirst = c[1]; } });
    if (first === null) {
      if (!years.some(function (y) { return entriesForYear(R, state, y).length; })) notes.push(state + ": no economic nexus rule in force in the years entered.");
      return { rows: out, notes: notes, start: null, first_cross: null };
    }
    var start = NEXT_YEAR[code] ? first + 1 : first;
    if (NEXT_YEAR[code]) notes.push((rule.name || state) + " measures the previous calendar year, so the duty starts in " + start + ", the year after the threshold was crossed in " + first + ".");
    if (PROXY[code]) notes.push((rule.name || state) + " measures " + rule.measurement_period + "; calendar-year totals are used as a stand-in.");
    if (rule.sales_basis === "retail" || rule.sales_basis === "taxable") notes.push((rule.name || state) + " counts " + rule.sales_basis + " sales toward the threshold; this test used the sales you entered, which may overstate it.");
    years.forEach(function (y) {
      if (y < start) return;
      var c = crossed(R, state, y, byYear[y].sales, byYear[y].invoices), why = c[1];
      if (y === first) why = whyFirst;
      else if (!c[0]) why = (!NEXT_YEAR[code] || y > first + 1) ? "duty continues from " + first : "threshold crossed in " + first;
      else if (NEXT_YEAR[code] && y === first + 1) why = "threshold crossed in " + first + " (" + whyFirst.split(" (")[0] + ")";
      out.push([y, why]);
    });
    return { rows: out, notes: notes, start: start, first_cross: first };
  }

  function rateFor(R, state, year) {
    var rule = R.states[state], on = year + "-12-31", hs = rule.rate_history || [];
    for (var i = 0; i < hs.length; i++) if ((hs[i].from || "0000-01-01") <= on && on <= (hs[i].to || "9999-12-31")) return hs[i].rate;
    return rule.state_rate;
  }

  /* ---------------------------------------------------------------- SaaS taxability (nexus.saas_tax) */
  function saasTax(R, S, state, year, amount, mix) {
    var row = S.states[state];
    var hs = row ? row.taxability_history.filter(function (h) { return (h.from || "0000-01-01") <= year + "-12-31" && (h.to || "9999-12-31") >= year + "-01-01"; }) : [];
    if (!hs.length) return { status: "flag", low: null, high: null, why: state + " SaaS treatment not confirmed" };
    hs.sort(function (a, b) { return (a.from || "") < (b.from || "") ? -1 : 1; });
    var h = hs[hs.length - 1];
    if (!h.verified) return { status: "flag", low: null, high: null, why: state + " SaaS treatment not confirmed" + (h.note ? " (" + h.note + ")" : "") };
    var rates = {}, words = {};
    var sides = ["b2b", "b2c"];
    for (var i = 0; i < sides.length; i++) {
      var sd = h[sides[i]];
      if (sd.status === "exempt") { rates[sides[i]] = 0; words[sides[i]] = sd.how || "exempt"; continue; }
      if (sd.status !== "taxable") return { status: "flag", low: null, high: null, why: state + " " + sides[i].toUpperCase() + " treatment depends on facts (" + (sd.how || "not confirmed") + ")" };
      rates[sides[i]] = (sd.rate ? sd.rate : rateFor(R, state, year)) * sd.base; words[sides[i]] = sd.how || "";
    }
    if (!rates.b2b && !rates.b2c) return { status: "exempt", low: 0, high: 0, why: "SaaS not taxable in " + state + " in " + year + " (" + words.b2b + ")" };
    var tot = (mix.b2b || 0) + (mix.b2c || 0) + (mix.unknown || 0) || 1;
    var sh = { b2b: (mix.b2b || 0) / tot, b2c: (mix.b2c || 0) / tot, unknown: (mix.unknown || 0) / tot };
    var lo = Math.min(rates.b2b, rates.b2c), hi = Math.max(rates.b2b, rates.b2c);
    var effLow = sh.b2b * rates.b2b + sh.b2c * rates.b2c + sh.unknown * lo, effHigh = sh.b2b * rates.b2b + sh.b2c * rates.b2c + sh.unknown * hi;
    if (effHigh === 0) return { status: "exempt", low: 0, high: 0, why: "SaaS not taxable in " + state + " in " + year + " for these customers" };
    return { status: "taxable", low: amount * effLow, high: amount * effHigh, why: rates.b2b === rates.b2c ? "taxable (" + words.b2b + "), " + pct(rates.b2b) + " of the price" : "business " + pct(rates.b2b) + ", consumers " + pct(rates.b2c) };
  }

  /* ---------------------------------------------------------------- back tax and escrow (checks.py sales tax math)
     byState: {ST: {year: {sales, invoices}}}; A: assumptions; asOf: "YYYY-MM-DD" */
  function backTax(R, S, byState, A, asOf, saas, mix) {
    var res = { states: [], low: 0, high: 0, vda: 0, audit: 0, flagged: [] };
    var asOfMs = Date.parse(asOf + "T00:00:00Z");
    Object.keys(byState).sort().forEach(function (st) {
      var ex = exposureYears(R, st, byState[st]), srow = { state: st, name: (R.states[st] || {}).name || st, start: ex.start, years: [], notes: ex.notes, low: 0, high: 0 };
      ex.rows.forEach(function (row) {
        var y = row[0], amt = byState[st][y].sales, rate = rateFor(R, st, y), tLow, tHigh, why = row[1];
        if (saas) {
          var tx = saasTax(R, S, st, y, amt, mix || { unknown: 1 });
          if (tx.status === "flag") { res.flagged.push(st + " " + y + ": " + tx.why); return; }
          if (tx.status === "exempt") { srow.notes.push(tx.why); return; }
          tLow = tx.low * A.saas_taxable_share_low; tHigh = tx.high * A.saas_taxable_share_high; why += "; " + tx.why;
        } else { tLow = amt * A.taxable_share_low * rate; tHigh = amt * A.taxable_share_high * rate; }
        var yrs = Math.max((asOfMs - Date.parse(y + "-12-31T00:00:00Z")) / 86400000 / 365.25, 0);
        var intHigh = tHigh * A.interest_rate * yrs, mid = (tLow + tHigh) / 2, midInt = mid * A.interest_rate * yrs;
        var high = tHigh + intHigh + tHigh * A.audit_penalty;
        res.low += tLow; res.high += high; res.vda += mid + midInt + mid * A.vda_penalty; res.audit += mid + midInt + mid * A.audit_penalty;
        srow.low += tLow; srow.high += high;
        srow.years.push({ year: y, sales: amt, rate: rate, why: why, low: tLow, high: high, interest: intHigh });
      });
      res.states.push(srow);
    });
    return res;
  }

  function money(n) { return (n < 0 ? "-$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US"); }
  function pct(x) { return (x * 100).toFixed(2) + "%"; }

  return { graduated: graduated, afterTax: afterTax, grossUp: grossUp, compareStockAsset: compareStockAsset,
    crossed: crossed, exposureYears: exposureYears, rateFor: rateFor, saasTax: saasTax, backTax: backTax,
    money: money, pct: pct, stateTerms: stateTerms };
});
