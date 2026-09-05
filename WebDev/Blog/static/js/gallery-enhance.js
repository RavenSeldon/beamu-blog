/* =============================================================
   gallery-enhance.js — Neurascape gallery QoL

   1) Lightbox / carousel for the photo album and inline post
      galleries: keyboard (arrows / Esc) + button nav, a counter,
      focus-trapped, closes on Esc / backdrop / close button.
      Progressive enhancement: the underlying <a class="photo-link">
      links still open the full image in a new tab when JS is off or
      on a modified click (cmd/ctrl/shift/alt/middle).

   2) Detail-page feature image: sets --hero on the .post-image
      wrapper from the image's own src so the CSS can paint a blurred
      backdrop of the image behind the (uncropped) hero. With no JS
      the CSS falls back to a plain glass panel.
   ============================================================= */
(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        initHeroBackdrop();
        initLightbox();
    });

    /* ---------- 1. Hero blurred backdrop ---------- */
    function initHeroBackdrop() {
        var boxes = document.querySelectorAll(
            '.single-post .post-image, .project-detail .post-image'
        );
        boxes.forEach(function (box) {
            var img = box.querySelector('.post-feature-img');
            if (!img) return;
            var apply = function () {
                var src = img.currentSrc || img.src;
                if (src) box.style.setProperty('--hero', 'url("' + src + '")');
            };
            if (img.complete && (img.currentSrc || img.src)) apply();
            else img.addEventListener('load', apply, { once: true });
        });
    }

    /* ---------- 2. Lightbox / carousel ---------- */
    var TRIGGER = '.photo-grid .photo-link, .post-content .gallery-figure';

    function initLightbox() {
        if (!document.querySelector(TRIGGER)) return;

        var els = {};
        var items = [];
        var index = 0;
        var lastFocused = null;

        buildDOM();

        document.addEventListener('click', function (e) {
            var trigger = e.target.closest(TRIGGER);
            if (!trigger) return;
            // Preserve native behaviour for modified clicks (open in new tab, etc.)
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            openFrom(trigger);
        });

        function scopeOf(trigger) {
            if (trigger.matches('.photo-link')) {
                var grid = trigger.closest('.photo-grid') || document;
                return Array.prototype.slice.call(grid.querySelectorAll('.photo-link'));
            }
            var content = trigger.closest('.post-content') || document;
            return Array.prototype.slice.call(content.querySelectorAll('.gallery-figure'));
        }

        function extract(el) {
            if (el.matches('.photo-link')) {
                var pimg = el.querySelector('img');
                var capEl = el.closest('.photo-card') &&
                    el.closest('.photo-card').querySelector('.caption');
                var cap = capEl ? capEl.textContent.trim() : '';
                if (/^no description$/i.test(cap)) cap = '';
                return {
                    full: el.getAttribute('href'),
                    fallback: pimg ? (pimg.currentSrc || pimg.src) : '',
                    alt: pimg ? pimg.alt : '',
                    caption: cap
                };
            }
            var img = el.querySelector('img');
            var fig = el.querySelector('figcaption');
            var base = img ? (img.getAttribute('src') || img.currentSrc || img.src) : '';
            var full = base ? base.replace('/medium/', '/large/') : '';
            return {
                full: full,
                fallback: img ? (img.currentSrc || img.src) : '',
                alt: img ? img.alt : '',
                caption: fig ? fig.textContent.trim() : ''
            };
        }

        function openFrom(trigger) {
            var scope = scopeOf(trigger);
            items = scope.map(extract);
            index = scope.indexOf(trigger);
            if (index < 0) index = 0;
            lastFocused = document.activeElement;
            render();
            els.root.classList.add('open');
            document.documentElement.style.overflow = 'hidden';
            els.close.focus();
        }

        function close() {
            els.root.classList.remove('open');
            els.root.classList.remove('lightbox-loading');
            document.documentElement.style.overflow = '';
            els.img.removeAttribute('src');
            if (lastFocused && lastFocused.focus) lastFocused.focus();
        }

        function go(delta) {
            if (items.length < 2) return;
            index = (index + delta + items.length) % items.length;
            render();
        }

        function render() {
            var it = items[index];
            if (!it) return;
            els.root.classList.add('lightbox-loading');
            els.img.onload = function () {
                els.root.classList.remove('lightbox-loading');
            };
            els.img.onerror = function () {
                els.root.classList.remove('lightbox-loading');
                if (it.fallback && els.img.getAttribute('src') !== it.fallback) {
                    els.img.src = it.fallback;
                }
            };
            els.img.src = it.full || it.fallback;
            els.img.alt = it.alt || '';
            els.caption.textContent = it.caption || '';
            els.caption.style.display = it.caption ? '' : 'none';

            var multi = items.length > 1;
            els.prev.style.display = multi ? '' : 'none';
            els.next.style.display = multi ? '' : 'none';
            els.counter.style.display = multi ? '' : 'none';
            els.counter.textContent = (index + 1) + ' / ' + items.length;

            preload(index + 1);
            preload(index - 1);
        }

        function preload(i) {
            if (items.length < 2) return;
            var it = items[(i + items.length) % items.length];
            if (it && it.full) {
                var im = new Image();
                im.src = it.full;
            }
        }

        function buildDOM() {
            var root = document.createElement('div');
            root.className = 'lightbox';
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-modal', 'true');
            root.setAttribute('aria-label', 'Image viewer');
            root.innerHTML =
                '<button class="lightbox-close" type="button" aria-label="Close (Esc)">' +
                    '<i class="fa-solid fa-xmark"></i></button>' +
                '<button class="lightbox-nav lightbox-prev" type="button" aria-label="Previous image">' +
                    '<i class="fa-solid fa-chevron-left"></i></button>' +
                '<figure class="lightbox-figure">' +
                    '<img class="lightbox-img" alt="">' +
                    '<figcaption class="lightbox-caption"></figcaption></figure>' +
                '<button class="lightbox-nav lightbox-next" type="button" aria-label="Next image">' +
                    '<i class="fa-solid fa-chevron-right"></i></button>' +
                '<div class="lightbox-counter" aria-live="polite"></div>';
            document.body.appendChild(root);

            els.root = root;
            els.close = root.querySelector('.lightbox-close');
            els.prev = root.querySelector('.lightbox-prev');
            els.next = root.querySelector('.lightbox-next');
            els.img = root.querySelector('.lightbox-img');
            els.caption = root.querySelector('.lightbox-caption');
            els.counter = root.querySelector('.lightbox-counter');

            els.close.addEventListener('click', close);
            els.prev.addEventListener('click', function () { go(-1); });
            els.next.addEventListener('click', function () { go(1); });

            root.addEventListener('click', function (e) {
                if (!e.target.closest(
                    '.lightbox-img, .lightbox-nav, .lightbox-close, .lightbox-caption'
                )) {
                    close();
                }
            });

            document.addEventListener('keydown', function (e) {
                if (!root.classList.contains('open')) return;
                if (e.key === 'Escape') { e.preventDefault(); close(); }
                else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
                else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
                else if (e.key === 'Tab') trapFocus(e);
            });
        }

        function trapFocus(e) {
            var focusable = [els.close, els.prev, els.next].filter(function (el) {
                return el && el.style.display !== 'none';
            });
            if (!focusable.length) return;
            var first = focusable[0];
            var last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            } else if (focusable.indexOf(document.activeElement) === -1) {
                e.preventDefault();
                first.focus();
            }
        }
    }
})();
