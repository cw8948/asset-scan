/* 자산 재물조사 PWA — 화면
 * 기록은 이 기기 브라우저(localStorage)에만 저장한다. 서버로 보내는 코드는 없다.
 * 위치는 사람이 입력(필수), 카메라·직접입력으로 들어온 값은 모두 자산 바코드로 본다(261020 사용자 지시).
 */
(function () {
  'use strict';

  var KEY = 'asset-scan-v1';
  var state = load();                // { location, records:[{ts,location,barcode,qty}] }
  var camOn = false, zoomed = false, torch = false;

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

  // 들어온 바코드 → 기록하거나 거부. 반환: true(기록) / false
  function handle(raw) {
    var code = norm(raw);
    var msg = null;
    if (!state.location) msg = '위치를 먼저 입력하세요.';
    else if (!code) msg = '빈 값입니다.';
    else if (code.length > 10) msg = code + ' — 10자를 넘어 양식에 맞지 않습니다.';
    else {
      var dup = state.records.find(function (r) { return r.barcode === code; });
      if (dup) msg = code + ' — 이미 ' + dup.location + ' 에서 찍었습니다.';
    }
    // 'scan' 이벤트 — 점검 도구(검증_스캔_v1.py)가 처리 횟수를 센다
    var emit = function (ok, m) { window.dispatchEvent(new CustomEvent('scan', { detail: { code: code, ok: ok, msg: m } })); };
    if (msg) {
      feedback('err'); flash('bad'); toast(msg, 'err');
      if (!state.location) $('loc').focus();
      emit(false, msg);
      return false;
    }
    state.records.push({ ts: Date.now(), location: state.location, barcode: code, qty: 1 });
    save(); render();
    feedback('ok'); flash('hit'); toast(code + ' 기록 (' + state.records.length + '건)', 'ok');
    emit(true, '');
    return true;
  }

  // 카메라
  function startCam() {
    if (!state.location) { toast('위치를 먼저 입력하세요.', 'err'); $('loc').focus(); return; }
    $('cam').classList.add('on');
    $('btnCam').disabled = true;
    Scanner.start($('video'), handle).then(function () {
      camOn = true; $('btnCam').disabled = false; $('btnCam').textContent = '카메라 끄기';
      var c = Scanner.caps();
      $('btnTorch').style.display = c.torch ? '' : 'none';
      $('btnZoom').style.display = c.zoom && c.zoom.max >= 1.5 ? '' : 'none';
      $('tools').classList.toggle('on', !!(c.torch || (c.zoom && c.zoom.max >= 1.5)));
      if (c.zoom && c.zoom.max >= 1.5) setZoom(true);   // 기본 2배 — 덜 가까이 대도 초점이 맞게
    }).catch(function (e) {
      $('cam').classList.remove('on'); $('btnCam').disabled = false;
      toast('카메라를 켜지 못했습니다: ' + (e && e.message || e), 'err');
    });
  }
  function stopCam() {
    Scanner.stop($('video'));
    camOn = false; torch = false; zoomed = false;
    $('cam').classList.remove('on'); $('tools').classList.remove('on');
    $('btnTorch').classList.remove('on');
    $('btnCam').textContent = '카메라 켜기';
  }
  function setZoom(on) {
    var c = Scanner.caps(); if (!c.zoom) return;
    Scanner.setZoom(on ? Math.min(2, c.zoom.max) : c.zoom.min).then(function (z) {
      if (z == null) return;
      zoomed = on; $('btnZoom').textContent = '확대 ×' + (on ? Math.round(z * 10) / 10 : 1);
      $('btnZoom').classList.toggle('on', on);
    });
  }

  // 피드백: 진동 + 짧은 소리 + 테두리 색
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
  var flashTimer = null;
  function flash(cls) {
    var b = $('band'); b.classList.remove('hit', 'bad'); b.classList.add(cls);
    clearTimeout(flashTimer); flashTimer = setTimeout(function () { b.classList.remove(cls); }, 600);
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
    lv.textContent = state.location || '위치를 먼저 입력하세요';
    lv.className = 'value' + (state.location ? '' : ' none');
    $('loc').classList.toggle('empty', !state.location);
    $('count').textContent = state.records.length + '건';
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

  function defaultName() { return '재물조사_' + AssetExport.stamp(Date.now()).date; }
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

  // 이벤트
  $('loc').value = state.location;
  $('loc').addEventListener('input', function () {
    state.location = norm(this.value); save(); render();
  });
  $('loc').addEventListener('change', function () {
    if (state.location) toast('위치 ' + state.location + ' 로 기록합니다.', 'ok');
  });
  $('loc').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });
  $('btnCam').onclick = function () { camOn ? stopCam() : startCam(); };
  $('btnZoom').onclick = function () { setZoom(!zoomed); };
  $('btnTorch').onclick = function () {
    Scanner.setTorch(!torch).then(function (ok) { if (ok) { torch = !torch; $('btnTorch').classList.toggle('on', torch); } });
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
    state.records = []; save(); render();
  };
  $('fname').placeholder = defaultName();
  document.addEventListener('visibilitychange', function () { if (document.hidden && camOn) stopCam(); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  render();
  window.App = { handle: handle, state: function () { return state; } };  // 점검용
})();
