// Vantly — shared front-end behaviour (nav scroll state, feature tabs, fade-up on scroll, smooth anchor scroll, scrollspy).
"use strict";

/* ── Nav scroll state ── */
var nav = document.getElementById('mainNav');
window.addEventListener('scroll', function() {
  nav.classList.toggle('scrolled', window.scrollY > 30);
}, { passive: true });

/* ── Mobile nav toggle ── the button existed in the markup with no matching behaviour;
   .menu-open is the class the CSS above actually listens for. ── */
var navToggle = document.getElementById('navToggle');
if (navToggle) {
  navToggle.addEventListener('click', function() {
    nav.classList.toggle('menu-open');
  });
  nav.querySelectorAll('.nav-links a').forEach(function(a) {
    a.addEventListener('click', function() { nav.classList.remove('menu-open'); });
  });
}

/* ── Feature tabs ── */
var tabs = document.querySelectorAll('.feature-tab');
var panels = document.querySelectorAll('.feature-panel');
tabs.forEach(function(tab) {
  tab.addEventListener('click', function() {
    var target = tab.dataset.tab;
    tabs.forEach(function(t) {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    panels.forEach(function(p) { p.classList.remove('active'); });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    var panel = document.getElementById('panel-' + target);
    if (panel) panel.classList.add('active');
  });
});

/* ── Intersection Observer — fade-up animations ── */
var observer = new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
document.querySelectorAll('.fade-up').forEach(function(el) {
  observer.observe(el);
});

/* ── Smooth scroll for anchor links ── */
document.querySelectorAll('a[href^="#"]').forEach(function(a) {
  a.addEventListener('click', function(e) {
    var id = a.getAttribute('href').slice(1);
    var target = document.getElementById(id);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

/* ── Active nav link on scroll ── */
var sections = document.querySelectorAll('section[id]');
var navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
var scrollSpy = new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) {
    if (entry.isIntersecting) {
      navLinks.forEach(function(link) {
        link.style.color = '';
        if (link.getAttribute('href') === '#' + entry.target.id) {
          link.style.color = 'var(--text)';
        }
      });
    }
  });
}, { rootMargin: '-30% 0px -60% 0px' });
sections.forEach(function(section) { scrollSpy.observe(section); });
