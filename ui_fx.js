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

  /* ══════════════════════════════════════════════════════════════
     第二批（2026-09-24）：跳出視窗、提示訊息、成功打勾、刪除收合、震動回饋
     做法：一個共用的 MutationObserver 盯著畫面，發現「視窗／提示訊息」出現或消失就播動畫，
     各工具不用一支一支改。只用 Web Animations（element.animate），動畫結束不留任何樣式；
     位移用獨立的 translate/scale 屬性，不會蓋掉元素原本用 transform 做的置中。
     ══════════════════════════════════════════════════════════════ */
  var MODAL_SEL = '.modal,.modal-bg,.modal-overlay,.mask,.mo,.mo-bg,.mo-ovl,.mo-box,.sheetbox,[role="dialog"]';
  var TOAST_SEL = '.toast,#toast';
  var SKIP_SEL  = '#splash,.fx-tool-sheet,.bottom-nav,.fx-ghost,.fx-rip-wrap,.fx-slider,.fx-success';
  var SHOW_CLS  = ['show', 'open', 'on', 'active', 'visible'];

  function hasShowCls(el) { for (var i = 0; i < SHOW_CLS.length; i++) if (el.classList.contains(SHOW_CLS[i])) return true; return false; }
  // 目前看不看得到。有些視窗用 .show/.open 切換、用 opacity 過場，剛切換的瞬間 opacity 還是 0，
  // 所以「用過 show 類 class 的元素」一律以 class 判斷，不看 opacity
  // opacity 只在「開機當下」拿來判斷（例如一直掛在畫面上、用 opacity:0 藏起來的提示框）；
  // 之後不看 opacity——很多提示框／視窗自己帶淡入動畫，剛出現那一瞬間 opacity 就是 0，會被誤判成看不到
  function visibleNow(el, initial) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (hasShowCls(el)) { el._fxUsesShow = true; return true; }
    if (el._fxUsesShow) return false;
    return initial ? parseFloat(cs.opacity) > 0.01 : true;
  }
  // React 直接用 inline style 寫的全螢幕遮罩（主控台的公告欄／宣導事項／請假等）
  function isInlineOverlay(el) {
    var st = el.getAttribute && el.getAttribute('style');
    return !!(st && st.indexOf('position: fixed') > -1 && /inset: 0/.test(st));
  }
  function kindOf(el) {
    if (!el || el.nodeType !== 1 || !el.matches) return '';
    if (el.matches(SKIP_SEL) || (el.closest && el.closest('.fx-ghost'))) return '';
    if (el.matches(TOAST_SEL)) return 'toast';
    if (el.matches(MODAL_SEL) || isInlineOverlay(el)) return 'modal';
    return '';
  }
  function isFullscreen(el) {
    var r = el.getBoundingClientRect();
    return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
  }
  function firstPanel(ov) {
    for (var c = ov.firstElementChild; c; c = c.nextElementSibling) {
      var cs = getComputedStyle(c);
      if (cs.display === 'none' || cs.position === 'fixed') continue;
      var r = c.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) return c;
    }
    return null;
  }
  function panelIn(p) {
    var r = p.getBoundingClientRect();
    var sheet = r.bottom >= innerHeight - 4; // 貼齊底部＝底部抽屜，往上滑出；其他＝中間彈出
    p.animate(sheet
      ? [{ translate: '0 48px', opacity: 0 }, { translate: '0 0', opacity: 1 }]
      : [{ scale: '.94', translate: '0 10px', opacity: 0 }, { scale: '1', translate: '0 0', opacity: 1 }],
      { duration: sheet ? 300 : 240, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }
  function isOpaquePage(el) {
    var m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor || '');
    if (!m) return false;
    var parts = m[1].split(','); return parts.length < 4 || parseFloat(parts[3]) >= 0.9;
  }
  function modalIn(el) {
    if (el._fxPage) {
      el.animate([{ translate: '36px 0', opacity: 0 }, { translate: '0 0', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
    } else if (isFullscreen(el)) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      var p = firstPanel(el); if (p) panelIn(p);
    } else {
      panelIn(el);
    }
  }
  // 消失動畫：元素已經被移除或藏起來了，複製一份「剛才顯示時的樣子」蓋在原處淡出，0.2 秒後刪掉。
  // 複本拿掉所有 id（避免程式 getElementById 抓錯）、不能點；含 iframe/影片的不做（複製會重新載入）
  function ghostOut(el, parent, before) {
    try {
      // 注意：React 用 inline style 的遮罩 className 是空字串，不能用 !el._fxShownClass 判斷
      if (el._fxShownClass === undefined || el.querySelector('iframe,video')) return;
      if (!parent || !parent.isConnected) parent = document.body;
      var g = el.cloneNode(true);
      g.className = el._fxShownClass;
      g.classList.add('fx-ghost');
      g.removeAttribute('id');
      var ids = g.querySelectorAll('[id]'); for (var i = 0; i < ids.length; i++) ids[i].removeAttribute('id');
      g.style.setProperty('display', el._fxShownDisplay || 'block', 'important');
      g.style.pointerEvents = 'none';
      parent.insertBefore(g, before && before.parentNode === parent ? before : null);
      var full = el._fxFull, a;
      if (el._fxPage) {
        a = g.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '36px 0' }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
      } else if (full) {
        a = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
        var p = g.firstElementChild;
        if (p && p.animate) p.animate([{ translate: '0 0' }, { translate: '0 24px' }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
      } else {
        a = g.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '0 24px' }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
      }
      a.onfinish = function () { if (g.parentNode) g.parentNode.removeChild(g); };
      setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 600); // 保險
    } catch (e) {}
  }

  /* ── G 震動回饋：只有 Android 有（iPhone 的瀏覽器不支援，會自動略過） ── */
  function haptic(type) {
    try { if (navigator.vibrate) navigator.vibrate(type === 'err' ? [40, 60, 40] : 15); } catch (e) {}
  }
  window.fxHaptic = haptic;

  /* ── B 提示訊息：從上方滑下；失敗的再左右抖一下 ── */
  function toastTone(el) {
    var c = ' ' + el.className + ' ', t = (el.textContent || '').trim();
    if (/ (err|fail|error|t-err|toast-err) /.test(c) || /^(❌|✗|⚠)/.test(t)) return 'err';
    if (/ (ok|t-ok|toast-ok|success) /.test(c) || /^(✅|✓|🗑)/.test(t)) return 'ok';
    return '';
  }
  function toastIn(el) {
    var r = el.getBoundingClientRect();
    var fromTop = r.top < innerHeight / 2; // 在上半部的提示從上往下滑，在下半部的從下往上
    var a = el.animate([{ translate: '0 ' + (fromTop ? -18 : 18) + 'px', opacity: 0 }, { translate: '0 0', opacity: 1 }],
      { duration: 320, easing: 'cubic-bezier(.2,1.3,.4,1)' });
    var tone = toastTone(el);
    if (tone === 'err') {
      a.onfinish = function () {
        el.animate([{ translate: '0 0' }, { translate: '-7px 0' }, { translate: '7px 0' }, { translate: '-5px 0' }, { translate: '5px 0' }, { translate: '0 0' }],
          { duration: 360, easing: 'ease-in-out' });
      };
    }
    if (tone) haptic(tone);
  }

  function onShow(el, kind) {
    if (kind === 'toast') { toastIn(el); return; }
    el._fxShownClass = el.className;
    el._fxShownDisplay = getComputedStyle(el).display;
    el._fxFull = isFullscreen(el);
    el._fxPage = el._fxFull && isOpaquePage(el);
    modalIn(el);
  }

  // 檢查一個元素：狀態從看不到→看得到就播進場；從看得到→看不到就播退場
  function check(el) {
    var kind = kindOf(el); if (!kind) return;
    var vis = visibleNow(el, !ready);
    if (vis && !el._fxVis) { el._fxVis = true; if (!fxReduced() && ready) onShow(el, kind); else if (kind === 'modal') { el._fxShownClass = el.className; el._fxShownDisplay = getComputedStyle(el).display; el._fxFull = isFullscreen(el); el._fxPage = el._fxFull && isOpaquePage(el); } }
    else if (!vis && el._fxVis) { el._fxVis = false; if (kind === 'modal' && !fxReduced() && ready) ghostOut(el, el.parentNode, el.nextSibling); }
  }
  var ready = false;
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    check(root);
    if (root.querySelectorAll) {
      var list = root.querySelectorAll(MODAL_SEL + ',' + TOAST_SEL + ',[style*="position: fixed"]');
      for (var i = 0; i < list.length; i++) check(list[i]);
    }
  }
  function startObserver() {
    try {
      if (!window.MutationObserver || !Element.prototype.animate) return;
      scan(document.body); // 開機時已經在畫面上的只記狀態、不播動畫
      ready = true;
      new MutationObserver(function (muts) {
        try {
          for (var i = 0; i < muts.length; i++) {
            var m = muts[i];
            if (m.type === 'attributes') { if (m.target._fxVis !== undefined || kindOf(m.target)) check(m.target); continue; }
            for (var j = 0; j < m.addedNodes.length; j++) scan(m.addedNodes[j]);
            for (var k = 0; k < m.removedNodes.length; k++) {
              var n = m.removedNodes[k];
              if (n.nodeType === 1 && n._fxVis && kindOf(n) === 'modal' && !fxReduced()) { n._fxVis = false; ghostOut(n, m.target, m.nextSibling); }
            }
          }
        } catch (e) {}
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver); else startObserver();

  /* ── C 送出成功：畫面中央畫出綠色打勾，0.9 秒後自己消失（不擋操作） ── */
  window.fxSuccess = function () {
    try {
      haptic('ok');
      if (fxReduced()) return;
      var d = document.createElement('div');
      d.className = 'fx-success';
      d.innerHTML = '<svg viewBox="0 0 52 52" width="92" height="92"><circle class="fx-sc" cx="26" cy="26" r="23"/>' +
                    '<path class="fx-sk2" d="M15 27 l7 7 l15 -16"/></svg>';
      document.body.appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1000);
    } catch (e) {}
  };

  /* ── F 刪除收合：記住「按了刪除的那一列」，刪除成功後先收合淡出，再重畫清單 ──
     用法（各工具刪除成功後）：fxRemoveThen(function(){ 重新載入清單(); });
     找不到那一列（例如已經重畫過、超過 60 秒）就直接執行，不影響原本流程 */
  var lastDel = null, lastDelAt = 0;
  function listItemOf(btn) {
    // 往上找「跟兄弟長得一樣的那一層」＝清單裡的一列；在跳出視窗裡按的（確認刪除鈕）不算
    if (btn.closest(MODAL_SEL) || btn.closest('[style*="position: fixed"]')) return null;
    for (var el = btn; el && el !== document.body; el = el.parentElement) {
      var par = el.parentElement; if (!par || el === btn) continue;
      var hh = el.getBoundingClientRect().height;
      if (hh < 36) continue;
      if (hh > innerHeight * 0.6) return null; // 已經爬到大容器了（例如只剩一筆），寧可不做動畫也不能收合整塊畫面
      var same = 0;
      for (var c = par.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === el.tagName && c.className === el.className) same++;
      if (same >= 2) return el;
    }
    return null;
  }
  document.addEventListener('click', function (ev) {
    try {
      var btn = ev.target && ev.target.closest && ev.target.closest('button,[onclick],.ico-btn,a');
      if (!btn) return;
      var sig = (btn.textContent || '') + ' ' + (btn.className || '') + ' ' + (btn.title || '') + ' ' + (btn.getAttribute('onclick') || '') + ' ' + btn.innerHTML;
      if (!/刪除|🗑|trash|del[A-Z(_]|delete|remove/i.test(sig)) return;
      var row = listItemOf(btn);
      if (row) { lastDel = row; lastDelAt = Date.now(); }
    } catch (e) {}
  }, true);
  window.fxRemoveThen = function (done) {
    var row = lastDel; lastDel = null;
    if (!row || !row.isConnected || Date.now() - lastDelAt > 60000 || fxReduced() || !row.animate) { done(); return; }
    try {
      var h = row.getBoundingClientRect().height;
      row.style.overflow = 'hidden';
      var a = row.animate([
        { opacity: 1, translate: '0 0', height: h + 'px' },
        { opacity: 0, translate: '-40px 0', height: h + 'px', offset: .55 },
        { opacity: 0, translate: '-40px 0', height: '0px', marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' }
      ], { duration: 380, easing: 'ease-in-out', fill: 'forwards' });
      var fired = false, go = function () { if (!fired) { fired = true; done(); } };
      a.onfinish = go; setTimeout(go, 700);
    } catch (e) { done(); }
  };

  window.addEventListener('resize', realignAll);
  window.addEventListener('load', realignAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(realignAll);
})();
