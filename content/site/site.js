/* SadakYatra — global script (har page pe chalta hai)
   Mobile menu, header shadow on scroll, scroll-reveal animation */
(function () {
  var ham = document.getElementById('sy-ham');
  var menu = document.getElementById('sy-mob-menu');
  var open = document.getElementById('sy-ham-open');
  var close = document.getElementById('sy-ham-close');
  if (ham && menu) {
    ham.addEventListener('click', function () {
      var isHidden = menu.classList.toggle('hidden');
      if (open) open.classList.toggle('hidden', !isHidden);
      if (close) close.classList.toggle('hidden', isHidden);
      ham.setAttribute('aria-expanded', String(!isHidden));
    });
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        menu.classList.add('hidden');
        if (open) open.classList.remove('hidden');
        if (close) close.classList.add('hidden');
      });
    });
  }
  var hdr = document.getElementById('sy-hdr');
  window.addEventListener('scroll', function () {
    if (hdr) hdr.classList.toggle('shadow-md', window.scrollY > 40);
  });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) e.target.classList.add('vis'); });
    }, { threshold: 0.08 });
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('vis'); });
  }
})();

/* ---- Services slider (Home page) ----
   Slider apne aap ginta hai kitne slides hain. Admin mein slide "Copy" karo → naya button khud banega.
   Button ka naam har slide ke yellow badge se aata hai. */
(function () {
  var sec = document.getElementById('services-slider');
  if (!sec || sec.getAttribute('data-sy-slider')) return;
  sec.setAttribute('data-sy-slider', '1');
  var slides = [].slice.call(sec.querySelectorAll('.svc-slide'));
  var oldPills = [].slice.call(sec.querySelectorAll('.svc-pill'));
  var labelEl = document.getElementById('svc-label');
  if (!slides.length || !oldPills.length) return;
  var wrap = oldPills[0].parentElement;
  var template = (oldPills[1] || oldPills[0]).cloneNode(false);
  var ON = ['bg-brand-yellow', 'text-brand-black'];
  var OFF = ['bg-white/8', 'text-gray-300', 'border', 'border-white/10'];
  var cur = 0, total = slides.length, timer;

  function badge(s) { return s.querySelector('[data-svc-title]') || s.querySelector('span.rounded-full'); }
  oldPills.forEach(function (p) { p.parentNode.removeChild(p); });
  var pills = slides.map(function (s, i) {
    var b = template.cloneNode(false);
    var t = badge(s);
    b.removeAttribute('onclick');
    b.setAttribute('data-svc', i);
    b.setAttribute('type', 'button');
    b.innerHTML = t ? t.innerHTML : ('Slide ' + (i + 1));
    b.addEventListener('click', function () { reset(); go(i); });
    wrap.appendChild(b);
    return b;
  });

  function go(n) {
    cur = (n + total) % total;
    slides.forEach(function (s, i) { s.classList.toggle('hidden', i !== cur); });
    pills.forEach(function (p, i) {
      ON.forEach(function (c) { p.classList.toggle(c, i === cur); });
      OFF.forEach(function (c) { p.classList.toggle(c, i !== cur); });
    });
    var t = badge(slides[cur]);
    if (labelEl) labelEl.textContent = (cur + 1) + ' / ' + total + ' \u2014 ' + (t ? t.textContent.replace(/\s+/g, ' ').trim() : '');
  }
  function start() { timer = setInterval(function () { go(cur + 1); }, 6000); }
  function reset() { clearInterval(timer); start(); }

  window.svcGo = function (n) { reset(); go(n); };
  window.svcNext = function () { reset(); go(cur + 1); };
  window.svcPrev = function () { reset(); go(cur - 1); };
  go(0); start();
})();
