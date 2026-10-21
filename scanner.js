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

  function tick(video, onCode) {
    if (!running) return;
    var next = function () { if (running) timer = setTimeout(function () { tick(video, onCode); }, 100); };
    phase = 1 - phase;
    if (video.readyState < 2 || !grab(video, phase === 1)) return next();
    var p = native
      ? native.detect(canvas).then(function (d) { return d.length ? d[0].rawValue : null; }).catch(function () { return null; })
      : Promise.resolve(zx ? decodeZxing() : null);
    p.then(function (raw) {
      var code = deb.feed(raw, Date.now());
      if (code) onCode(code);
      next();
    });
  }

  // video: <video> 요소, onCode(code): 받아들인 코드, decoder: 'zxing'(기본) | 'native' → Promise('native'|'zxing')
  function start(video, onCode, decoder) {
    if (running) return Promise.resolve(native ? 'native' : 'zxing');
    canvas = canvas || document.createElement('canvas');
    ctx = ctx || canvas.getContext('2d', { willReadFrequently: true });
    deb.reset();
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(function (s) {
      stream = s;
      var track = s.getVideoTracks()[0];
      try { track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {}); } catch (e) {}
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
    var t = track(), c = {};
    try { c = (t && t.getCapabilities) ? t.getCapabilities() : {}; } catch (e) {}
    return { torch: !!c.torch, zoom: c.zoom ? { min: c.zoom.min, max: c.zoom.max } : null };
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

  return { start: start, stop: stop, caps: caps, setTorch: setTorch, setZoom: setZoom, Debouncer: Debouncer, VALID: VALID };
});
