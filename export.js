/* 재물조사 스캔 기록 → DT900Rcv.exe 와 같은 모양의 .xls (BIFF8)
 * 양식 근거: 분석_터미널_엑셀양식_v1.md §3
 *   Sheet1: DATE(숫자 YYYYMMDD) | TIME(숫자 HHMMSS) | LOCATION(10자 공백채움) | BARCODE(10자 공백채움) | QUANTITY(숫자)
 *   Sheet2·Sheet3: 빈 시트
 * 브라우저(window.AssetExport)와 node(require) 양쪽에서 쓴다. XLSX 는 호출하는 쪽이 넘긴다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AssetExport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HEADER = ['DATE', 'TIME', 'LOCATION', 'BARCODE', 'QUANTITY'];
  var PAD = 10;

  function pad10(s) {
    s = String(s == null ? '' : s).trim();
    return s.length >= PAD ? s : s + ' '.repeat(PAD - s.length);
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  // ts(ms) → { date: 20261016, time: 140619 } 기기 현지 시각 기준
  function stamp(ts) {
    var d = new Date(ts);
    return {
      date: Number(d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate())),
      time: Number(two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()))
    };
  }

  // records: [{ts, location, barcode, qty}] → 2차원 배열 (헤더 포함, 바코드 오름차순)
  function toRows(records) {
    var rows = records.map(function (r) {
      var s = stamp(r.ts);
      return [s.date, s.time, pad10(r.location), pad10(r.barcode), Number(r.qty || 1)];
    });
    rows.sort(function (a, b) {
      var ka = a[3].trim(), kb = b[3].trim();
      return ka < kb ? -1 : ka > kb ? 1 : (a[0] - b[0]) || (a[1] - b[1]);
    });
    return [HEADER.slice()].concat(rows);
  }

  // → ArrayBuffer(.xls)
  function buildXls(XLSX, records) {
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(toRows(records));
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Sheet2');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Sheet3');
    return XLSX.write(wb, { bookType: 'biff8', type: 'array' });
  }

  return { HEADER: HEADER, PAD: PAD, pad10: pad10, stamp: stamp, toRows: toRows, buildXls: buildXls };
});
