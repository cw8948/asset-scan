/* 자산 재물조사 PWA — 스캔 화면
 * 기록은 이 기기 브라우저(localStorage)에만 저장한다. 서버로 보내는 코드는 없다.
 */
(function () {
  'use strict';

  var KEY = 'asset-scan-v1';
  var LOC_PATTERN = /^S\d{4}$/;      // 위치 라벨 추정 규칙 (S1301 등) — 실측 1건 기준, 확인 필요
  var REPEAT_MS = 2500;              // 카메라가 같은 코드를 연달아 읽는 것은 무시

  var state = load();                // { location, records:[{ts,location,barcode,qty}] }
  var armedLoc = false;              // [위치 라벨 찍기] 를 누른 뒤 다음 1건은 위치
  var lastRead = { code: '', at: 0 };
  var cam = null, camOn = false;

  var $ = function (id) { return document.getElementById(id); };

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.records)) return s;
    } catch (e) { /* 비공개 창 등 */ }
    return { location: '', records: [] };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('기기에 저장하지 못했습니다. 엑셀로 먼저 내보내세요.', 'err'); }
  }

  function norm(code) { return String(code || '').trim().toUpperCase(); }

  // 읽은 코드를 위치/자산으로 가른다. 반환: {kind:'loc'|'asset'|'reject', msg}
  function classify(code) {
    if (!code) return { kind: 'reject', msg: '빈 값입니다.' };
    if (code.length > 10) return { kind: 'reject', msg: code + ' — 10자를 넘어 양식에 맞지 않습니다.' };
    if (armedLoc) return { kind: 'loc' };
    if ($('autoLoc').checked && LOC_PATTERN.test(code)) return { kind: 'loc' };
    if (!state.location) return { kind: 'reject', msg: '위치 라벨을 먼저 찍으세요.' };
    var dup = state.records.find(function (r) { return r.barcode === code; });
    if (dup) return { kind: 'reject', msg: code + ' — 이미 ' + dup.location + ' 에서 찍었습니다.' };
    return { kind: 'asset' };
  }

  function handle(raw) {
    var code = norm(raw);
    var c = classify(code);
    if (c.kind === 'loc') {
      state.location = code; armedLoc = false; save(); render();
      feedback('ok'); toast('위치 ' + code + ' 로 바꿨습니다.', 'ok');
    } else if (c.kind === 'asset') {
      state.records.push({ ts: Date.now(), location: state.location, barcode: code, qty: 1 });
      save(); render();
      feedback('ok'); toast(code + ' 기록 (' + state.records.length + '건)', 'ok');
    } else {
      feedback('err'); toast(c.msg, 'err');
    }
  }

  // 카메라 연속 읽기 — 같은 코드 반복은 무시
  function onCamRead(text) {
    var code = norm(text), now = Date.now();
    if (code === lastRead.code && now - lastRead.at < REPEAT_MS) return;
    lastRead = { code: code, at: now };
    handle(code);
  }

  function startCam() {
    if (!window.Html5Qrcode) { toast('바코드 라이브러리를 불러오지 못했습니다.', 'err'); return; }
    var F = Html5QrcodeSupportedFormats;
    cam = cam || new Html5Qrcode('reader', {
      formatsToSupport: [F.CODE_128, F.CODE_39, F.CODE_93, F.CODABAR, F.ITF, F.EAN_13, F.QR_CODE],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false
    });
    cam.start({ facingMode: 'environment' },
      { fps: 10, qrbox: function (w, h) { return { width: Math.floor(w * 0.85), height: Math.floor(Math.min(h * 0.45, 160)) }; } },
      onCamRead, function () {})
      .then(function () { camOn = true; $('btnCam').textContent = '카메라 끄기'; })
      .catch(function (e) { toast('카메라를 켜지 못했습니다: ' + e, 'err'); });
  }
  function stopCam() {
    if (!cam || !camOn) return;
    cam.stop().then(function () { camOn = false; $('btnCam').textContent = '카메라 켜기'; });
  }

  // 피드백: 진동 + 짧은 소리
  var actx = null;
  function feedback(kind) {
    try { navigator.vibrate && navigator.vibrate(kind === 'ok' ? 60 : [120, 60, 120]); } catch (e) {}
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = kind === 'ok' ? 1400 : 300;
      g.gain.value = 0.08; o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + (kind === 'ok' ? 0.08 : 0.3));
    } catch (e) {}
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('toast');
    t.textContent = msg; t.className = 'toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast ' + kind; }, kind === 'err' ? 3000 : 1400);
  }

  function hhmmss(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function render() {
    var lv = $('locValue');
    lv.textContent = state.location || '위치 라벨을 먼저 찍으세요';
    lv.className = 'value' + (state.location ? '' : ' none');
    $('count').textContent = state.records.length + '건';
    $('btnLoc').classList.toggle('armed', armedLoc);
    var tb = $('list'); tb.innerHTML = '';
    state.records.slice().reverse().forEach(function (r) {
      var tr = document.createElement('tr');
      [hhmmss(r.ts), r.location, r.barcode].forEach(function (v, i) {
        var td = document.createElement('td'); td.textContent = v;
        if (i) td.className = 'mono'; tr.appendChild(td);
      });
      var td = document.createElement('td'); td.className = 'del';
      var b = document.createElement('button'); b.className = 'ghost'; b.textContent = '삭제';
      b.onclick = function () {
        if (!confirm(r.barcode + ' 기록을 지울까요?')) return;
        state.records = state.records.filter(function (x) { return x !== r; });
        save(); render();
      };
      td.appendChild(b); tr.appendChild(td); tb.appendChild(tr);
    });
  }

  function defaultName() {
    var s = AssetExport.stamp(Date.now());
    return '재물조사_' + s.date;
  }
  function fileName() {
    var n = ($('fname').value || defaultName()).trim().replace(/[\\/:*?"<>|]/g, '_');
    return /\.xls$/i.test(n) ? n : n + '.xls';
  }
  function makeFile() {
    if (!state.records.length) { toast('내보낼 기록이 없습니다.', 'warn'); return null; }
    var buf = AssetExport.buildXls(XLSX, state.records);
    return new File([buf], fileName(), { type: 'application/vnd.ms-excel' });
  }

  function saveFile() {
    var f = makeFile(); if (!f) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    toast(f.name + ' 저장 (' + state.records.length + '건)', 'ok');
  }
  function shareFile() {
    var f = makeFile(); if (!f) return;
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      navigator.share({ files: [f], title: f.name }).catch(function () {});
    } else {
      toast('이 기기는 파일 공유를 지원하지 않습니다. [엑셀 저장]을 쓰세요.', 'warn');
    }
  }

  // 이벤트 연결
  $('btnCam').onclick = function () { camOn ? stopCam() : startCam(); };
  $('btnLoc').onclick = function () {
    armedLoc = !armedLoc; render();
    if (armedLoc) toast('다음에 찍는 바코드를 위치로 씁니다.', 'warn');
  };
  $('manual').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    handle(this.value); this.value = '';
  });
  $('btnSave').onclick = saveFile;
  $('btnShare').onclick = shareFile;
  $('btnClear').onclick = function () {
    if (!state.records.length) return;
    if (!confirm('기록 ' + state.records.length + '건을 모두 지울까요? 엑셀로 내보냈는지 먼저 확인하세요.')) return;
    state = { location: '', records: [] }; save(); render();
  };
  $('fname').placeholder = defaultName();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  render();
  window.App = { handle: handle, classify: classify, state: function () { return state; } };  // 점검용
})();
