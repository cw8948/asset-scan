/* 카메라 바코드 스캐너 — 원본 해상도로 판독한다.
 * html5-qrcode 는 영상을 화면 표시 크기(폭 ~360px)로 줄여 판독해 1차원 바코드의 가는 막대가 뭉개졌다(261020 실측: 가짜 카메라 0회 인식).
 * 판독기: 모든 기기 ZXing(기본). 안드로이드 크롬 내장 BarcodeDetector 는 현장 실기에서 정방향도 잘 못 읽고
 *   거꾸로는 전혀 못 읽었다(261021 사용자 피드백, 같은 시각 아이폰 = ZXing 은 양호) → 주소 뒤 ?decoder=native 일 때만 쓴다(비교 시험용).
 * 오인식·반복 방지(Debouncer): 같은 값이 연속 2번 읽혀야 받아들이고, 같은 라벨을 대고 있는 동안은 다시 내보내지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scanner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VALID = /^[A-Z0-9-]{3,10}$/;   // 양식 BARCODE 칸 = 10자 이내 영숫자
  var CONFIRM_MS = 800;              // 연속 2회 판독 사이 허용 간격
  var GONE_MS = 1500;                // 방금 받은 라벨이 화면에서 이만큼 안 보여야 다시 받음
  var COOLDOWN_MS = 700;             // 하나 받은 직후 잠깐 쉼

  function Debouncer() { this.reset(); }
  Debouncer.prototype.reset = function () {
    this.cand = null; this.candN = 0; this.candAt = 0;
    this.last = null; this.lastSeen = 0; this.coolUntil = 0;
  };
  // value: 판독 문자열 또는 null, now: ms → 받아들인 코드 또는 null
  Debouncer.prototype.feed = function (value, now) {
    if (value == null) return null;
    value = String(value).trim().toUpperCase();
    if (!VALID.test(value)) return null;
    if (value === this.last && now - this.lastSeen < GONE_MS) { this.lastSeen = now; return null; }
    if (now < this.coolUntil) return null;
    if (value === this.cand && now - this.candAt <= CONFIRM_MS) this.candN++;
    else { this.cand = value; this.candN = 1; }
    this.candAt = now;
    if (this.candN < 2) return null;
    this.last = value; this.lastSeen = now; this.coolUntil = now + COOLDOWN_MS;
    this.cand = null; this.candN = 0;
    return value;
  };

  var stream = null, timer = null, running = false;
  var canvas = null, ctx = null, native = null, zx = null;
  var deb = new Debouncer();

  function makeNative() {
    if (!('BarcodeDetector' in self)) return Promise.resolve(null);
    return BarcodeDetector.getSupportedFormats().then(function (sup) {
      var want = ['code_128', 'code_39', 'code_93'].filter(function (f) { return sup.indexOf(f) >= 0; });
      return want.length ? new BarcodeDetector({ formats: want }) : null;
    }).catch(function () { return null; });
  }

  function makeZxing() {
    if (!self.ZXing) return null;
    var Z = self.ZXing, hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.CODE_93]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    var r = new Z.MultiFormatReader(); r.setHints(hints);
    return r;
  }

  function decodeZxing() {
    var Z = self.ZXing;
    try {
      var bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      return zx.decodeWithState(bmp).getText();
    } catch (e) { return null; }
    finally { zx.reset(); }
  }

  // 가운데 띠를 원본 해상도로 잘라 판독한다.
  // 가로 띠(폭 90% × 높이 40%)와 세로 띠(폭 40% × 높이 90%, 90° 돌려 가로로 눕힘)를 번갈아 본다.
  // 세로 띠가 없으면 세로로 돌아간 바코드를 한 번도 못 읽는다(261020 탐침: 90°·270° 판독 0회).
  var phase = 0;
  function grab(video, vertical) {
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return false;
    var sw = Math.round(vw * (vertical ? 0.4 : 0.9)), sh = Math.round(vh * (vertical ? 0.9 : 0.4));
    var long = vertical ? sh : sw, k = Math.min(1, 1280 / long);
    var dw = Math.round(sw * k), dh = Math.round(sh * k);
    var sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    if (!vertical) {
      canvas.width = dw; canvas.height = dh;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    } else {
      canvas.width = dh; canvas.height = dw;
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(video, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }
    return true;
  }

  // 초점: 안드로이드는 연속 초점(continuous)을 걸어도 바코드처럼 작은 대상에서 초점을 놓친 채 멈추는 기기가 있다(261027 현장).
  //   → 아무것도 못 읽은 채 REFOCUS_MS 가 지나면 한 번 초점을 다시 잡게(single-shot) 했다가 연속 초점으로 되돌린다.
  //   화면을 누르면 그 자리로 바로 다시 잡는다(focusAt). 지원하지 않는 기기(아이폰 등)에서는 아무것도 하지 않는다.
  //   수동 초점만 되는 기기(초점 방식 = manual 하나 — 갤럭시 S24 + 삼성 인터넷, 261027 ?diag 실측: 고정 거리라 라벨이 흐림)는
  //   앱이 초점 거리를 직접 정한다: 라벨을 대는 거리 후보(NEAR, 미터)를 못 읽을 때마다 차례로 바꾼다. 화면을 눌러도 다음 거리로.
  var REFOCUS_MS = 2500;
  var NEAR = [0.15, 0.1, 0.2, 0.3, 0.12, 0.25];
  var lastRead = 0, lastRefocus = 0, sweep = 0;
  function rawCaps() {
    var t = track(), c = {};
    try { c = (t && t.getCapabilities) ? t.getCapabilities() : {}; } catch (e) {}
    return c;
  }
  function focusModes() { return rawCaps().focusMode || []; }
  function manualOnly() {
    var m = focusModes();
    return m.indexOf('manual') >= 0 && m.indexOf('continuous') < 0 && m.indexOf('single-shot') < 0 && !!rawCaps().focusDistance;
  }
  function manualStep() {
    var fd = rawCaps().focusDistance;
    var d = NEAR[sweep++ % NEAR.length];
    d = Math.max(fd.min, Math.min(fd.max, d));
    return apply({ focusMode: 'manual', focusDistance: d });
  }
  function apply(adv) {
    var t = track(); if (!t) return Promise.resolve(false);
    try { return t.applyConstraints({ advanced: [adv] }).then(function () { return true; }, function () { return false; }); }
    catch (e) { return Promise.resolve(false); }
  }
  function refocus(point) {
    var modes = focusModes(); lastRefocus = Date.now();
    if (manualOnly()) return manualStep();
    if (modes.indexOf('single-shot') < 0) return Promise.resolve(false);
    var adv = { focusMode: 'single-shot' };
    if (point) adv.pointsOfInterest = [point];
    return apply(adv).then(function (ok) {
      if (!ok && point) return apply({ focusMode: 'single-shot' });   // 초점 위치 지정을 못 하는 기기
      return ok;
    }).then(function (ok) {
      if (modes.indexOf('continuous') >= 0) setTimeout(function () { if (running) apply({ focusMode: 'continuous' }); }, 1200);
      return ok;
    });
  }
  // x, y: 영상 안의 위치(0~1)
  function focusAt(x, y) { return refocus({ x: x, y: y }); }

  function tick(video, onCode) {
    if (!running) return;
    var next = function () { if (running) timer = setTimeout(function () { tick(video, onCode); }, 100); };
    phase = 1 - phase;
    if (video.readyState < 2 || !grab(video, phase === 1)) return next();
    var p = native
      ? native.detect(canvas).then(function (d) { return d.length ? d[0].rawValue : null; }).catch(function () { return null; })
      : Promise.resolve(zx ? decodeZxing() : null);
    p.then(function (raw) {
      var now = Date.now();
      if (raw) lastRead = now;
      else {
        var wait = manualOnly() ? 1200 : REFOCUS_MS;   // 수동 초점은 거리 후보를 빨리 돌린다(읽히면 그 거리에 머문다)
        if (now - lastRead > wait && now - lastRefocus > wait) refocus(null);
      }
      var code = deb.feed(raw, now);
      if (code) onCode(code);
      next();
    });
  }

  // 안드로이드 다중 렌즈 폰: facingMode 만 주면 광각·망원 렌즈가 잡혀 가까운 라벨에 초점이 안 맞는 기기가 있다.
  //   크롬은 렌즈를 「camera2 N, facing back」 으로 부르고 기본(주) 카메라가 0 번이다 → 0 번이 따로 있으면 그것으로 다시 연다.
  //   이름(label)은 카메라 권한을 받은 뒤에만 보이므로, 먼저 facingMode 로 연 다음에 고른다.
  function mainBackCamera(current) {
    if (!/Android/i.test(navigator.userAgent) || !navigator.mediaDevices.enumerateDevices) return Promise.resolve(null);
    return navigator.mediaDevices.enumerateDevices().then(function (ds) {
      var main = ds.filter(function (d) { return d.kind === 'videoinput' && /camera2 0\b.*back/i.test(d.label); })[0];
      return main && main.label !== current ? main.deviceId : null;
    }).catch(function () { return null; });
  }

  var VIDEO = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  function open() {
    return navigator.mediaDevices.getUserMedia({
      audio: false, video: Object.assign({ facingMode: { ideal: 'environment' } }, VIDEO)
    }).then(function (s) {
      return mainBackCamera(s.getVideoTracks()[0].label).then(function (id) {
        if (!id) return s;
        s.getTracks().forEach(function (t) { t.stop(); });
        return navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({ deviceId: { exact: id } }, VIDEO) })
          .catch(function () {   // 0 번을 못 열면 처음 방식으로
            return navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({ facingMode: { ideal: 'environment' } }, VIDEO) });
          });
      });
    });
  }

  // video: <video> 요소, onCode(code): 받아들인 코드, decoder: 'zxing'(기본) | 'native' → Promise('native'|'zxing')
  function start(video, onCode, decoder) {
    if (running) return Promise.resolve(native ? 'native' : 'zxing');
    canvas = canvas || document.createElement('canvas');
    ctx = ctx || canvas.getContext('2d', { willReadFrequently: true });
    deb.reset();
    lastRead = lastRefocus = Date.now();
    return open().then(function (s) {
      stream = s;
      sweep = 0;
      if (focusModes().indexOf('continuous') >= 0) apply({ focusMode: 'continuous' });
      else if (manualOnly()) manualStep();
      video.setAttribute('playsinline', ''); video.muted = true;
      video.srcObject = s;
      return video.play();
    }).then(function () {
      return decoder === 'native' ? makeNative() : null;
    }).then(function (det) {
      native = det; zx = det ? null : makeZxing();
      if (!native && !zx) throw new Error('바코드 판독기를 불러오지 못했습니다');
      running = true; tick(video, onCode);
      return native ? 'native' : 'zxing';
    });
  }

  function stop(video) {
    running = false; clearTimeout(timer);
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (video) video.srcObject = null;
  }

  // 플래시·확대 — 지원하는 핸드폰에서만(주로 안드로이드 크롬)
  function track() { return stream ? stream.getVideoTracks()[0] : null; }
  function caps() {
    var t = track(), c = {}, s = {};
    try { c = (t && t.getCapabilities) ? t.getCapabilities() : {}; } catch (e) {}
    try { s = (t && t.getSettings) ? t.getSettings() : {}; } catch (e) {}
    return { torch: !!c.torch, zoom: c.zoom ? { min: c.zoom.min, max: c.zoom.max } : null,
             focus: c.focusMode || [], label: t ? t.label : '', size: (s.width || 0) + '×' + (s.height || 0),
             dist: c.focusDistance ? c.focusDistance.min + '~' + c.focusDistance.max + '(현재 ' + s.focusDistance + ')' : '' };
  }
  function setTorch(on) {
    var t = track(); if (!t) return Promise.resolve(false);
    return t.applyConstraints({ advanced: [{ torch: !!on }] }).then(function () { return true; }, function () { return false; });
  }
  function setZoom(z) {
    var t = track(), c = caps(); if (!t || !c.zoom) return Promise.resolve(null);
    z = Math.max(c.zoom.min, Math.min(c.zoom.max, z));
    return t.applyConstraints({ advanced: [{ zoom: z }] }).then(function () { return z; }, function () { return null; });
  }

  return { start: start, stop: stop, caps: caps, setTorch: setTorch, setZoom: setZoom, focusAt: focusAt,
           Debouncer: Debouncer, VALID: VALID };
});
