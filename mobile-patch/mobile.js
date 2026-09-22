/**
 * 移动端适配注入 v0.4（批次 16，对应 APK 界面美化）
 * v0.2（历史）：VisualViewport + translateY 方案，竖屏横屏通用，
 *   rAF 节流 + 异常保护，暴露 --kb-height 供 CSS 使用。
 * v0.3 新增（v1.3.1）：键盘防自动聚焦 —— 用 pointerdown 位置判断焦点来源，
 *   切换话题/新会话自动聚焦输入框时立即 blur（不弹键盘），
 *   只有用户真的点击输入框才弹键盘。
 * v0.4 新增（批次 16 / F4）：蓝色大肥鱼 —— 把 DSH web 界面里的官方墨鲸
 *   （侧栏品牌鱼标 + 「探索未至之境」hero 鱼标）替换为蓝色大肥鱼内联 SVG。
 *   形状单一事实源 .local/b16-fish.svg 逐字符内联（详见文件末尾模块注释）。
 * 注：窄屏侧栏改造（三条杠 + 浮层）在核心源码 dsh-client-ui-layout，不在此文件。
 */
(function () {
  if (!window.visualViewport) return;
  var vv = window.visualViewport;
  var app = document.getElementById('root') || document.body;
  var lastKb = 0;
  var rafId = 0;
  var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };

  function computeKb() {
    // 键盘高度 ≈ 布局视口高度 - 视觉视口高度 - 视觉视口顶部偏移
    var kb = window.innerHeight - vv.height - vv.offsetTop;
    return Math.max(0, Math.round(kb));
  }

  function apply() {
    var kb = computeKb();
    if (Math.abs(kb - lastKb) < 6) return;
    lastKb = kb;
    document.documentElement.style.setProperty('--kb-height', kb + 'px');
    if (!app) return;
    if (kb > 120) {
      // 键盘弹出：把 App 容器向上平移，露出底部输入栏
      app.style.transform = 'translateY(' + (-kb) + 'px)';
      app.style.transition = 'transform 0.12s ease-out';
      document.documentElement.classList.add('kb-open');
    } else {
      // 键盘收起：恢复原位
      app.style.transform = '';
      app.style.transition = 'transform 0.12s ease-out';
      document.documentElement.classList.remove('kb-open');
    }
  }

  function schedule() {
    if (rafId) return;
    rafId = raf(function () {
      rafId = 0;
      apply();
    });
  }

  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', function () {
    // 旋转后等布局稳定再算一次
    setTimeout(schedule, 200);
  });
  // 记录用户最后一次真实点击（pointerdown）位置，用于区分
  // 「用户主动点击输入框」与「程序化聚焦」（如切换新话题后输入框自动 focus）
  var lastPointer = null;
  document.addEventListener('pointerdown', function (e) {
    lastPointer = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, true);

  function isInputLike(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  document.addEventListener('focusin', function (e) {
    var t = e && e.target;
    if (!isInputLike(t)) return;
    // 判断这次聚焦是否由用户直接点击该输入框产生
    var userTapped = false;
    if (lastPointer && Date.now() - lastPointer.t < 800) {
      var r = t.getBoundingClientRect();
      userTapped = r.left <= lastPointer.x && lastPointer.x <= r.right &&
                   r.top <= lastPointer.y && lastPointer.y <= r.bottom;
    }
    if (!userTapped) {
      // 程序化聚焦（切换话题/新会话自动 focus）：立即失焦，避免键盘自动弹出
      setTimeout(function () {
        if (document.activeElement === t) t.blur();
      }, 0);
      return;
    }
    setTimeout(schedule, 150);
  });
  document.addEventListener('focusout', function (e) {
    if (isInputLike(e && e.target)) setTimeout(schedule, 150);
  });

  // 初始计算（等待首帧布局稳定）
  setTimeout(schedule, 100);
})();

// 注：插件按钮已改为核心实现（dsh-client-ui-cordis 注册到
// conversation.session.header.utilities，单一实例），由核心渲染；
// 位置用 mobile.css 的 position:fixed 挪到三条杠下方（不动 DOM，
// 保证 React 事件委托有效）。

// ============================================================
// 蓝色大肥鱼（批次 16 / F4，v0.4 新增）
// ------------------------------------------------------------
// 把 DSH web 界面里的官方「墨鲸」换成蓝色大肥鱼（F4 落位两处）：
//   1. 侧栏品牌鱼标：span.hHd-Xa_brandMark（宽屏）/ span.hHd-Xa_railMark
//      （窄轨，两形态互斥渲染）内的 <svg viewBox="0 0 23.16 17.04">
//      （FishLogo， OfficialBrandMark 经 sidebar.brand.mark 槽位渲染）；
//   2. 空会话 hero「探索未至之境」左侧鱼标：span.pXSMma_fishHitbox 内
//      <svg class="pXSMma_fish" viewBox="0 0 23.16 17.04">（HeroFish，
//      conversation.hero.brand.mark 槽位的官方回退组件）。
// 锚点依据（DOM 侦察，见 docs/批次16w6-web侧界面报告.md）：
//   viewBox="0 0 23.16 17.04" 由 dsh-client-ui-primitives 的
//   FISH_LOGO_VIEWBOX = {width:23.16, height:17.04} 运行时拼出，全前端唯一
//   （BrandWordmark 用 182x24 / 156x24，其余 svg 均不同），不会误伤；
//   hover 游动动画只改 path 的 d（SMIL animate），viewBox 恒定，锚点稳定。
// React 安全替换：绝不移除 React 管理的节点 —— 原鲸 svg 加 data-dsh-fished
//   标记并 display:none（FishLogo/HeroFish 的 vdom 均无 style 属性，React
//   不会回写内联样式），肥鱼以内联 <svg> 兄弟节点插入；父容器卸载时二者
//   一起移除，无悬空节点引用（replaceWith 会触发 React NotFoundError，禁用）。
// 幂等：已标记的原 svg 跳过（肥鱼兄弟丢失时补挂一次）；MutationObserver
//   兜底动态渲染（侧栏宽/窄切换、hero 卸载重挂会出现未标记的新鲸鱼）。
// 保守：找不到元素/解析异常一律静默跳过，不报错、不影响页面其它部分。
// 形状红线：DSH_FISH_SVG 与单一事实源 .local/b16-fish.svg 逐字符一致；
//   仅运行时把渐变 id="bodyGrad" 改名为实例唯一 id（多鱼同页防 id 冲突，
//   path/几何/颜色零改动）。自检结果：.local/b16w6-check.txt。
// ============================================================
(function () {
  // 单一事实源：.local/b16-fish.svg 全文内联（自检脚本做逐字符回读比对）
  var DSH_FISH_SVG = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 96" width="120" height="96">',
    '  <defs>',
    '    <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">',
    '      <stop offset="0" stop-color="#6FB6FF"/>',
    '      <stop offset="1" stop-color="#2E6FDB"/>',
    '    </linearGradient>',
    '  </defs>',
    '  <!-- 气泡 -->',
    '  <circle cx="16" cy="26" r="3" fill="#FFFFFF" opacity="0.4"/>',
    '  <circle cx="9" cy="17" r="2" fill="#FFFFFF" opacity="0.35"/>',
    '  <!-- 尾鳍（右） -->',
    '  <path d="M92,50 Q112,34 116,28 Q119,44 114,52 Q118,62 112,74 Q106,62 90,54 Z"',
    '        fill="#8CC8FF" stroke="#2B5FB8" stroke-opacity="0.35" stroke-width="1.5"/>',
    '  <!-- 背鳍（上） -->',
    '  <path d="M42,23 Q56,10 72,21 Q58,26 47,31 Z" fill="#8CC8FF" stroke="#2B5FB8" stroke-opacity="0.35" stroke-width="1.5"/>',
    '  <!-- 胖身体 -->',
    '  <ellipse cx="56" cy="52" rx="40" ry="30" fill="url(#bodyGrad)"/>',
    '  <!-- 白肚皮 -->',
    '  <ellipse cx="52" cy="64" rx="30" ry="16" fill="#D6E9FF" opacity="0.85"/>',
    '  <!-- 侧鳍 -->',
    '  <ellipse cx="46" cy="66" rx="9" ry="6" fill="#8CC8FF" stroke="#2B5FB8" stroke-opacity="0.35"',
    '           stroke-width="1.2" transform="rotate(-25 46 66)"/>',
    '  <!-- 眼睛 -->',
    '  <circle cx="34" cy="44" r="7" fill="#FFFFFF"/>',
    '  <circle cx="32" cy="45" r="4" fill="#16294D"/>',
    '  <circle cx="30" cy="41" r="1.8" fill="#FFFFFF"/>',
    '  <!-- 微笑嘴 -->',
    '  <path d="M22,57 Q29,63 37,60" fill="none" stroke="#1B3A73" stroke-width="2" stroke-linecap="round"/>',
    '</svg>'
  ].join('\n');

  var WHALE_VIEWBOX = '0 0 23.16 17.04';
  var seq = 0;

  // 量出原鲸的渲染尺寸，肥鱼在原盒子里居中适配（meet 不裁剪、不撑破布局）
  function measuredSize(orig) {
    var w = 0, h = 0;
    try {
      var r = orig.getBoundingClientRect();
      if (r && r.width > 1 && r.height > 1) { w = r.width; h = r.height; }
    } catch (e) { /* 忽略，走属性兜底 */ }
    if (!w) w = parseFloat(orig.getAttribute('width')) || 24;
    if (!h) h = parseFloat(orig.getAttribute('height')) || w * 96 / 120;
    return { w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100 };
  }

  function buildFish(orig) {
    var size = measuredSize(orig);
    var uid = 'dsh-fish-grad-' + (++seq);
    var host = document.createElement('div');
    host.innerHTML = DSH_FISH_SVG.replace(/bodyGrad/g, uid);
    var fish = host.firstElementChild;
    if (!fish || (fish.tagName + '').toLowerCase() !== 'svg') return null;
    fish.setAttribute('width', size.w);
    fish.setAttribute('height', size.h);
    fish.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    fish.setAttribute('class', 'dsh-mobile-fish');
    fish.setAttribute('aria-hidden', 'true');
    fish.setAttribute('focusable', 'false');
    fish.setAttribute('data-dsh-fish', '1');
    return fish;
  }

  function placeFish(orig, fish) {
    if (orig.nextSibling) orig.parentNode.insertBefore(fish, orig.nextSibling);
    else orig.parentNode.appendChild(fish);
  }

  function fishIn(orig) {
    try {
      if (!orig || !orig.getAttribute) return;
      var vb = orig.getAttribute('viewBox');
      if (vb !== WHALE_VIEWBOX) return;                  // 非官方墨鲸：不动
      if (orig.getAttribute('data-dsh-fished') === '1') {
        // 幂等：已替换过；肥鱼兄弟若丢失（框架重建）则补挂
        var sib = orig.nextElementSibling;
        if (sib && sib.getAttribute('data-dsh-fish') === '1') return;
        var again = buildFish(orig);
        if (again) placeFish(orig, again);
        return;
      }
      var fish = buildFish(orig);
      if (!fish) return;                                 // 解析失败：静默跳过
      orig.setAttribute('data-dsh-fished', '1');
      orig.style.display = 'none';
      placeFish(orig, fish);
    } catch (e) { /* 任何异常静默，绝不破坏页面 */ }
  }

  function sweep() {
    var whales;
    try {
      whales = document.querySelectorAll('svg[viewBox="' + WHALE_VIEWBOX + '"]');
    } catch (e) { return; }
    for (var i = 0; i < whales.length; i++) fishIn(whales[i]);
  }

  var timer = 0;
  function scheduleSweep() {
    if (timer) return;
    timer = setTimeout(function () { timer = 0; sweep(); }, 120);
  }

  function start() {
    sweep();                                             // 首轮（SPA 可能尚未渲染）
    setTimeout(sweep, 100);                              // 与键盘适配模块同款：等首帧稳定
    setTimeout(sweep, 600);
    setTimeout(sweep, 2000);
    if (typeof MutationObserver === 'function') {
      try {
        new MutationObserver(scheduleSweep).observe(document.documentElement, {
          childList: true, subtree: true
        });
      } catch (e) { /* 观察失败仅靠上面的定时兜底 */ }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
