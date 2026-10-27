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

  // 카메라로 읽은 값의 자산코드 형식 — 7자리 = 분류 1자 + 취득연도 2자 + 일련번호 4자리
  //   분류: B 건물 · C 건물장비 · D 구축물 · E 기기장비 · F 공기구비품 · G 차량운반구 · X 소프트웨어 등 · Z 기타(예술품 등)
  //   취득연도: 1990년대 = 숫자 2자리(95~99) / 2000년대~ = 연대 문자 + 끝자리(A0=2000, B9=2019, C5=2025)
  //   근거: 2025 유형자산명세서 22개 시트 고유 코드 23,167건 전부 일치(261021). ⚠ 2030년(D0~)부터는 [A-C] → [A-D] 로 넓힐 것
  // 거꾸로·잘려 읽힌 값(숫자로 시작하는 값, 6자리로 잘린 값 등)을 막는다. 직접 입력은 사람이 본 값이라 검사하지 않는다.
  var ASSET_RE = /^[BCDEFGXZ](9\d|[A-C]\d)\d{4}$/;

  // 들어온 바코드 → 기록하거나 거부. source: 'camera' | 'manual'. 반환: true(기록) / false
  function handle(raw, source) {
    var code = norm(raw);
    var msg = null;
    if (!state.location) msg = '위치를 먼저 입력하세요.';
    else if (!code) msg = '빈 값입니다.';
    else if (code.length > 10) msg = code + ' — 10자를 넘어 양식에 맞지 않습니다.';
    else if (source === 'camera' && !ASSET_RE.test(code)) msg = code + ' — 자산코드 형식이 아닙니다. 바코드를 테두리 안에 다시 맞추거나 직접 입력하세요.';
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
    var decoder = /[?&]decoder=native\b/.test(location.search) ? 'native' : 'zxing';
    Scanner.start($('video'), function (c) { handle(c, 'camera'); }, decoder).then(function (used) {
      camOn = true; App.decoder = used;
      $('btnCam').disabled = false; $('btnCam').textContent = '카메라 끄기';
      var c = Scanner.caps();
      $('btnTorch').style.display = c.torch ? '' : 'none';
      $('btnZoom').style.display = c.zoom && c.zoom.max >= 1.5 ? '' : 'none';
      $('tools').classList.toggle('on', !!(c.torch || (c.zoom && c.zoom.max >= 1.5)));
      // 주소 뒤 ?diag — 현장 기기의 카메라 정보를 화면에 띄운다(초점 문제를 캡처로 받기 위함)
      if (/[?&]diag\b/.test(location.search)) {
        $('tip').textContent = c.label + ' · ' + c.size + ' · 초점 ' + (c.focus.join('/') || '정보 없음') +
                               ' · 확대 ' + (c.zoom ? c.zoom.min + '~' + c.zoom.max : '없음');
      }
      // 확대는 기본 1배 — 2배 기본은 안드로이드에서 평소처럼 가까이 대면 바코드가 테두리를 벗어났다(261021, 아이폰은 확대 미지원이라 1배로 양호)
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
    t.style.top = (document.querySelector('header').getBoundingClientRect().bottom + 8) + 'px';
    t.textContent = msg; t.className = 'toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast ' + kind; }, kind === 'ok' ? 1400 : msg.length > 40 ? 5000 : 3000);
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
    if (camOn) stopCam();   // 판독 반복을 멈춰 저사양 폰에서 저장·공유 창이 늦게 뜨지 않게(261021 피드백)
    var buf = AssetExport.buildXls(XLSX, state.records);
    return new File([buf], fileName(), { type: 'application/vnd.ms-excel' });
  }
  function saveFile() {
    var f = makeFile(); if (!f) return;
    downloadToPhone(f, false);
  }
  // 안드로이드 크롬은 웹 공유로 보낼 수 있는 파일 종류를 사진·PDF·텍스트 등으로 제한해 .xls 가 막힌다(261021 현장: 공유 무반응).
  // 막히면 핸드폰에 저장하고, 파일 앱에서 공유하도록 안내한다. 아이폰 사파리는 그대로 공유 창이 뜬다.
  function shareFile() {
    var f = makeFile(); if (!f) return;
    var ok = false;
    try { ok = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { ok = false; }
    if (!ok) { downloadToPhone(f, true); return; }
    navigator.share({ files: [f], title: f.name }).catch(function (e) {
      if (e && e.name === 'AbortError') return;   // 사용자가 공유 창을 닫음
      downloadToPhone(f, true);
    });
  }
  function downloadToPhone(f, fromShare) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    if (fromShare) toast((/Android/i.test(navigator.userAgent) ? '안드로이드에서는' : '이 브라우저에서는') +
      ' 엑셀 파일을 바로 공유할 수 없어 ' + f.name + ' 을 다운로드 폴더에 저장했습니다. 파일 앱 → 다운로드에서 공유하세요.', 'warn');
    else toast(f.name + ' 저장 (' + state.records.length + '건)', 'ok');
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
  // 화면을 누르면 그 자리에 초점을 다시 잡는다(지원하는 안드로이드만)
  $('cam').addEventListener('click', function (e) {
    if (!camOn) return;
    var r = this.getBoundingClientRect();
    Scanner.focusAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height).then(function (ok) {
      if (ok) toast('초점을 다시 맞춥니다.', 'ok');
    });
  });
  $('btnTorch').onclick = function () {
    Scanner.setTorch(!torch).then(function (ok) { if (ok) { torch = !torch; $('btnTorch').classList.toggle('on', torch); } });
  };
  // 직접 입력: [기록] 버튼 또는 키보드 완료(Enter) → form submit 하나로 받는다(keydown 'Enter' 는 안드로이드에서 안 올 때가 있다)
  $('manualForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var m = $('manual');
    if (handle(m.value, 'manual')) { m.value = ''; m.focus(); }   // 실패하면 고쳐 쓸 수 있게 값을 남긴다
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

  // 카카오톡 안의 간이 브라우저에서 열리면 카메라·파일 저장이 제한되고, 기록도 크롬과 따로 쌓인다.
  // 카카오톡이 제공하는 「외부 브라우저로 열기」 주소로 넘기고, 안 넘어갈 때를 위해 안내를 띄운다.
  var kakaoRedirect = null;
  var ua = navigator.userAgent || '';
  if (/KAKAOTALK/i.test(ua)) {
    var android = /Android/i.test(ua);
    $('inapp').style.display = '';
    $('inappMsg').textContent = android
      ? '카메라와 엑셀 저장이 제대로 되지 않아 크롬으로 엽니다. 자동으로 넘어가지 않으면 오른쪽 위 ⋮ → 「다른 브라우저로 열기」를 누르세요.'
      : '카메라와 엑셀 저장이 제대로 되지 않아 사파리로 엽니다. 자동으로 넘어가지 않으면 오른쪽 아래 ⋯(또는 공유) → 「Safari로 열기」를 누르세요.';
    kakaoRedirect = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href);
    try { location.href = kakaoRedirect; } catch (e) {}
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  render();
  window.App = { handle: handle, state: function () { return state; }, decoder: null, kakaoRedirect: kakaoRedirect };  // 점검용
})();
