/*
 * CampusFind motion layer, built with the `motion` library (by the Framer Motion team) into public/js/motion.js.
 * Rebuild with: npm run build:motion
 *
 * Rules: content is always readable without this file (it only hides what it is about to animate, and a
 * failsafe shows everything after 2 s). Nothing runs when the user prefers reduced motion. Only opacity and
 * transform are animated, so there is no layout shift.
 */
import { animate } from 'motion/mini'; // the Web Animations API build: a fraction of the size of the full engine
import { inView, stagger } from 'motion';

const root = document.documentElement;
const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = [0.22, 1, 0.36, 1]; // ease-out-quint: fast start, soft landing

function reveal() {
  root.classList.remove('motion-pending');
}

if (reduce || !('animate' in Element.prototype)) {
  reveal();
} else {
  // Hero and page banners: tip up from a slight 3D lean while they fade in.
  const lead = document.querySelectorAll('.cf-hero, .band, .page-head');
  if (lead.length) animate(lead, { opacity: [0, 1], transform: ['perspective(1400px) rotateX(7deg) translateY(18px)', 'perspective(1400px) rotateX(0deg) translateY(0)'] }, { duration: 0.7, ease: EASE });

  // Hero side cards swing in on the Y axis, like cards being laid on a table.
  const side = document.querySelectorAll('.cf-lf .lf__card, .band__facts li');
  if (side.length) animate(side, { opacity: [0, 1], transform: ['perspective(1000px) rotateY(-14deg) translateX(24px)', 'perspective(1000px) rotateY(0deg) translateX(0)'] }, { duration: 0.65, delay: stagger(0.09, { startDelay: 0.18 }), ease: EASE });

  // Groups (grids, tiles, steps) stagger in as they scroll into view, once.
  const groups = ['.spot', '.cats', '.grid', '.who', '.steps', '.plans', '.threads', '.kpis'];
  document.querySelectorAll(groups.join(',')).forEach((group) => {
    const items = Array.from(group.children);
    if (!items.length) return;
    items.forEach((el) => { el.style.opacity = '0'; });
    inView(group, () => {
      // Hand the hidden state over to the animation itself; otherwise the inline opacity would win again when it ends.
      items.forEach((el) => { el.style.opacity = ''; });
      // flip up from a 3D tilt, one after another
      animate(items, { opacity: [0, 1], transform: ['perspective(900px) rotateX(14deg) translateY(26px)', 'perspective(900px) rotateX(0deg) translateY(0)'] }, { duration: 0.6, delay: stagger(0.05), ease: EASE });
    }, { amount: 0.1 });
  });

  // Flash messages drop in.
  const flashes = document.querySelectorAll('.flash');
  if (flashes.length) animate(flashes, { opacity: [0, 1], transform: ['translateY(-8px)', 'translateY(0)'] }, { duration: 0.35, ease: EASE });

  // Buttons and cards: a small press response (pointer only; keyboard keeps the focus ring).
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.btn, .cf-chip, .seg__tab');
    if (t) animate(t, { transform: ['scale(1)', 'scale(0.97)', 'scale(1)'] }, { duration: 0.22, ease: 'easeOut' });
  });

  // Rotating phrase in the hero (adapted from the 21st.dev "Animated hero"): the word slides up and out, the next slides in.
  document.querySelectorAll('[data-rotate]').forEach((box) => {
    const words = box.getAttribute('data-rotate').split('|').filter(Boolean);
    const el = box.querySelector('.rotator__word');
    if (!el || words.length < 2) return;
    let i = 0;
    setInterval(() => {
      if (document.hidden) return;
      i = (i + 1) % words.length;
      const leave = animate(el, { opacity: [1, 0], transform: ['translateY(0)', 'translateY(-60%)'] }, { duration: 0.28, ease: [0.4, 0, 1, 1] });
      Promise.resolve(leave && leave.finished ? leave.finished : leave).then(() => {
        el.textContent = words[i];
        animate(el, { opacity: [0, 1], transform: ['translateY(60%)', 'translateY(0)'] }, { duration: 0.42, ease: EASE });
      });
    }, 2600);
  });

  // Number ticker (adapted from 21st.dev "Stats & KPIs"): counts up from zero the first time a number scrolls into view.
  document.querySelectorAll('[data-count]:not(textarea):not(input)').forEach((el) => {
    const target = Number(el.getAttribute('data-count'));
    if (!Number.isFinite(target) || target <= 0 || target > 100000) return;
    el.style.fontVariantNumeric = 'tabular-nums';
    inView(el, () => {
      const t0 = performance.now(), dur = Math.min(1400, 500 + target * 25);
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur), v = Math.round(target * (1 - Math.pow(1 - k, 3)));
        el.textContent = String(v);
        if (k < 1) requestAnimationFrame(step); else el.textContent = String(target);
      };
      requestAnimationFrame(step);
    }, { amount: 0.6 });
  });

  // 3D tilt: cards lean toward the pointer, with a soft light that follows it. Mouse and trackpad only;
  // touch devices and keyboard users get the normal flat card.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const TILT = '.listing, .cat, .spot__card, .who__card, .cf-lf .lf__card, .plan';
    const MAX = 7; // degrees: enough to feel physical, small enough to stay calm
    let active = null, frame = 0, px = 0, py = 0;
    const apply = () => {
      frame = 0;
      if (!active) return;
      const r = active.getBoundingClientRect();
      const x = (px - r.left) / r.width - 0.5, y = (py - r.top) / r.height - 0.5;
      active.style.transform = `perspective(900px) rotateX(${(-y * MAX).toFixed(2)}deg) rotateY(${(x * MAX).toFixed(2)}deg) translateY(-4px)`;
      active.style.setProperty('--glare-x', `${((x + 0.5) * 100).toFixed(1)}%`);
      active.style.setProperty('--glare-y', `${((y + 0.5) * 100).toFixed(1)}%`);
    };
    const release = (el) => { el.style.transform = ''; el.classList.remove('is-tilting'); };
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest(TILT);
      if (el !== active) { if (active) release(active); active = el; if (el) el.classList.add('is-tilting'); }
      if (!el) return;
      px = e.clientX; py = e.clientY;
      if (!frame) frame = requestAnimationFrame(apply);
    }, { passive: true });
    document.addEventListener('pointerleave', () => { if (active) release(active); active = null; });
    window.addEventListener('scroll', () => { if (active) { release(active); active = null; } }, { passive: true });
  }

  requestAnimationFrame(reveal);
}

// Failsafe: never leave content hidden, even if something above throws or the tab throttles animations.
setTimeout(() => {
  reveal();
  document.getAnimations().forEach((a) => { try { if (a.playState !== 'finished') a.finish(); } catch (e) { /* infinite animations cannot finish */ } });
  document.querySelectorAll('.spot > *, .cats > *, .grid > *, .who > *, .steps > *, .plans > *, .threads > *, .kpis > *').forEach((el) => {
    if (el.style.opacity === '0') el.style.opacity = '';
  });
}, 2000);
