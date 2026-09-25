/* ══════════════════════════════════════════════════════════════
   天鷹保全 · 共用 UI 動態效果（2026-09-24）— 搭配 ui_fx.css
   提供：
   ・主要按鈕按下漣漪＋光澤（自動套用，不用改各工具的按鈕程式）
   ・iOS 的 :active 按壓回饋（Safari 預設不觸發，這裡補上）
   ・fxSkeletonCards(n)：產生骨架畫面 HTML
   ・fxMoveSlider(膠囊, 目標按鈕)：滑動膠囊定位
   ・fxReduced()：手機是否開了「減少動態效果」
   全部包在 try 裡，任何錯誤都不影響工具本身運作。
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // 手機是否開了「減少動態效果」
  function fxReduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  window.fxReduced = fxReduced;

  /* ── ③ 主要按鈕：哪些按鈕要有漣漪。
     各工具的主要按鈕 class 不一樣，這裡列白名單；其他按鈕要加的話在標籤上寫 data-fx="ripple" 即可 */
  var RIPPLE_SEL = '.btn-gold,.btn-outline,.btn-indigo,.btn-primary,.btn-pri,.btn-submit,.submit-btn,' +
                   '.btn-form-submit,.btn-green,.btn-upload,.btn-update-schedule,.cbtn-checkin,.fab-add,.mo-submit,[data-fx~="ripple"]';

  function ripple(btn, x, y) {
    if (fxReduced()) return;
    var r = btn.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // 按鈕是 static 定位時暫時改成 relative，讓效果層貼齊按鈕；多次連按用計數，最後一個效果結束才還原
    if (!btn._fxN) {
      if (getComputedStyle(btn).position === 'static') { btn.style.position = 'relative'; btn._fxPosSet = true; }
    }
    btn._fxN = (btn._fxN || 0) + 1;

    var size = Math.max(r.width, r.height) * 2.2;
    var wrap = document.createElement('span');
    wrap.className = 'fx-rip-wrap';
    var c = document.createElement('span');
    c.className = 'fx-rip';
    c.style.width = c.style.height = size + 'px';
    c.style.left = (x - r.left - size / 2) + 'px';
    c.style.top = (y - r.top - size / 2) + 'px';
    var s = document.createElement('span');
    s.className = 'fx-shine';
    wrap.appendChild(c);
    wrap.appendChild(s);
    btn.appendChild(wrap);

    setTimeout(function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      btn._fxN = Math.max(0, (btn._fxN || 1) - 1);
      if (!btn._fxN && btn._fxPosSet) { btn.style.position = ''; btn._fxPosSet = false; }
    }, 700);
  }

  document.addEventListener('pointerdown', function (ev) {
    try {
      if (ev.button !== undefined && ev.button !== 0) return; // 只理左鍵／手指
      var btn = ev.target && ev.target.closest && ev.target.closest(RIPPLE_SEL);
      if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
      ripple(btn, ev.clientX, ev.clientY);
    } catch (e) { /* 效果失敗不影響按鈕本身 */ }
  }, { passive: true });

  // iOS Safari 預設不觸發 :active，註冊一個空的 touchstart 就會生效（按壓回饋靠它）
  document.addEventListener('touchstart', function () {}, { passive: true });

  /* ── ④ 骨架畫面：產生 n 張「卡片輪廓」HTML。hint 是可選的一行小字（例如「正在讀取施工資料…」） */
  window.fxSkeletonCards = function (n, hint) {
    var one = '<div class="fx-sk-card">' +
      '<span class="fx-sk" style="width:110px;height:18px"></span>' +
      '<span class="fx-sk" style="width:60%;height:20px;margin-top:10px"></span>' +
      '<span class="fx-sk" style="width:42%;height:16px;margin-top:8px"></span>' +
      '<div class="fx-sk-row"><span class="fx-sk" style="width:120px;height:26px"></span>' +
      '<span class="fx-sk" style="width:48px;height:26px"></span></div></div>';
    var html = hint ? '<div class="fx-sk-hint">' + hint + '</div>' : '';
    for (var i = 0; i < (n || 3); i++) html += one;
    return html;
  };

  /* ── ⑤ 滑動膠囊：把 slider 移到 target 的位置與大小。
     第一次定位不播動畫（不然會從左上角滑進來），之後才加 transition */
  window.fxMoveSlider = function (slider, target) {
    try {
      if (!slider || !target) return;
      slider._fxTarget = target;
      slider.style.width = target.offsetWidth + 'px';
      slider.style.height = target.offsetHeight + 'px';
      slider.style.transform = 'translate(' + target.offsetLeft + 'px,' + target.offsetTop + 'px)';
      if (!slider.classList.contains('fx-on')) {
        slider.classList.add('fx-on');
        requestAnimationFrame(function () { requestAnimationFrame(function () { slider.classList.add('fx-anim'); }); });
      }
    } catch (e) {}
  };
  // 螢幕旋轉／字型載入完成後寬度會變，重新對齊所有膠囊
  function realignAll() {
    var list = document.querySelectorAll('.fx-slider');
    for (var i = 0; i < list.length; i++) {
      if (list[i]._fxTarget && list[i]._fxTarget.isConnected) window.fxMoveSlider(list[i], list[i]._fxTarget);
    }
  }
  window.addEventListener('resize', realignAll);
  window.addEventListener('load', realignAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(realignAll);
})();
