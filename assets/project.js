// Project page behaviour: navigation, inline PDF rendering with full screen,
// the resume viewer, and the render lightbox. Loaded as an ES module.
import * as pdfjsLib from "./pdfjs/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./pdfjs/pdf.worker.min.mjs", import.meta.url).href;

// ---- Scroll lock (iOS Safari ignores body overflow:hidden) ----
var scrollLockY = 0, scrollLocked = false;
function lockScroll() {
  if (scrollLocked) return;
  scrollLocked = true;
  scrollLockY = window.scrollY || window.pageYOffset || 0;
  document.body.style.position = "fixed";
  document.body.style.top = (-scrollLockY) + "px";
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
}
function unlockScroll() {
  if (!scrollLocked) return;
  scrollLocked = false;
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  window.scrollTo(0, scrollLockY);
}

// ---- Mobile menu ----
var navToggle = document.getElementById("nav-toggle");
var navMenu = document.getElementById("site-menu");
function closeMenu() {
  if (!navMenu) return;
  navMenu.classList.remove("open");
  navToggle.setAttribute("aria-expanded", "false");
}
if (navToggle && navMenu) {
  navToggle.addEventListener("click", function () {
    var open = navMenu.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  navMenu.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", closeMenu); });
  document.addEventListener("click", function (e) {
    if (navMenu.classList.contains("open") && !navMenu.contains(e.target) && !navToggle.contains(e.target)) closeMenu();
  });
}

// ---- PDF renderer: draws every page of a document into a container ----
function makeRenderer(pagesEl, statusEl) {
  var state = { session: 0, task: null, zoom: 1 };

  function applyZoom() {
    pagesEl.querySelectorAll("canvas").forEach(function (c) {
      var base = parseFloat(c.dataset.basew || "0");
      if (base) c.style.width = Math.round(base * state.zoom) + "px";
    });
  }

  async function load(url) {
    state.session += 1;
    var mySession = state.session;
    state.zoom = 1;
    if (state.task) { try { state.task.destroy(); } catch (e) {} state.task = null; }
    pagesEl.innerHTML = "";
    statusEl.innerHTML = "Loading document&hellip;";
    statusEl.hidden = false;
    try {
      var task = pdfjsLib.getDocument(url);
      state.task = task;
      var pdf = await task.promise;
      if (mySession !== state.session) return null;
      statusEl.hidden = true;
      var inner = document.createElement("div");
      inner.className = "pages-inner";
      pagesEl.appendChild(inner);
      for (var n = 1; n <= pdf.numPages; n += 1) {
        if (mySession !== state.session) return null;
        var page = await pdf.getPage(n);
        if (mySession !== state.session) return null;
        var containerW = Math.min(Math.max((pagesEl.clientWidth || 824) - 24, 260), 1100);
        var base = page.getViewport({ scale: 1 });
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var scale = containerW / base.width;
        var vp = page.getViewport({ scale: scale * dpr });
        if (vp.width > 4096) { vp = page.getViewport({ scale: (scale * dpr) * (4096 / vp.width) }); }
        var canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        var cssW = Math.min(containerW, Math.floor(vp.width / dpr));
        canvas.dataset.basew = cssW;
        canvas.style.width = Math.round(cssW * state.zoom) + "px";
        inner.appendChild(canvas);
        // "print" intent renders without requestAnimationFrame pacing, so pages
        // keep rendering even if the tab is backgrounded mid-load
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, intent: "print" }).promise;
      }
      return pdf.numPages;
    } catch (err) {
      if (mySession !== state.session) return null;
      statusEl.hidden = false;
      statusEl.innerHTML = 'The document could not be displayed here. <a href="' + url + '">Open the PDF directly</a>.';
      return null;
    }
  }

  function clear() {
    state.session += 1;
    if (state.task) { try { state.task.destroy(); } catch (e) {} state.task = null; }
    pagesEl.innerHTML = "";
  }

  return {
    load: load,
    clear: clear,
    zoomIn: function () { state.zoom = Math.min(3, state.zoom + 0.25); applyZoom(); },
    zoomOut: function () { state.zoom = Math.max(0.5, state.zoom - 0.25); applyZoom(); }
  };
}

// ---- Inline document panel ----
var panel = document.querySelector(".doc-panel");
var panelFullscreen = false;
var setPanelFullscreen = function () {};
if (panel) {
  var panelRenderer = makeRenderer(panel.querySelector(".doc-pages"), panel.querySelector(".doc-status"));
  var countEl = panel.querySelector(".dt-count");
  var fsBtn = panel.querySelector(".dt-fullscreen");
  panelRenderer.load(panel.getAttribute("data-doc")).then(function (n) {
    if (n && countEl) countEl.textContent = n + (n === 1 ? " page" : " pages");
  });
  panel.querySelector(".dt-zoom-in").addEventListener("click", panelRenderer.zoomIn);
  panel.querySelector(".dt-zoom-out").addEventListener("click", panelRenderer.zoomOut);
  setPanelFullscreen = function (on) {
    panelFullscreen = on;
    panel.classList.toggle("fullscreen", on);
    fsBtn.textContent = on ? "Close" : "Full screen";
    fsBtn.setAttribute("aria-label", on ? "Exit full screen" : "View document full screen");
    if (on) lockScroll(); else unlockScroll();
  };
  fsBtn.addEventListener("click", function () { setPanelFullscreen(!panelFullscreen); });

  // Re-render if the panel's width changes a lot (phone rotation, window resize),
  // so pages always fit the available width
  var pagesBox = panel.querySelector(".doc-pages");
  var renderedW = pagesBox.clientWidth;
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var w = pagesBox.clientWidth;
      if (!w || Math.abs(w - renderedW) / renderedW < 0.15) return;
      renderedW = w;
      panelRenderer.load(panel.getAttribute("data-doc")).then(function (n) {
        if (n && countEl) countEl.textContent = n + (n === 1 ? " page" : " pages");
      });
    }, 300);
  });
}

// ---- Overlay viewer (used for the resume link) ----
var viewer = document.getElementById("doc-viewer");
var viewerOpen = false;
var closeViewer = function () {};
if (viewer) {
  var dvRenderer = makeRenderer(document.getElementById("dv-pages"), document.getElementById("dv-status"));
  var dvTitle = document.getElementById("dv-title");
  var dvClose = document.getElementById("dv-close");
  var dvDl = document.getElementById("dv-dl");
  var dvDlLabel = document.getElementById("dv-dl-label");
  var dvLastFocus = null;
  function openViewer(url, title, dlHref, dlLabel) {
    dvLastFocus = document.activeElement;
    dvTitle.textContent = title || "Document";
    if (dlHref) { dvDl.setAttribute("href", dlHref); dvDlLabel.textContent = dlLabel || "Download"; dvDl.hidden = false; }
    else { dvDl.hidden = true; dvDl.removeAttribute("href"); }
    document.getElementById("dv-scroll").scrollTop = 0;
    viewer.classList.add("open");
    viewerOpen = true;
    lockScroll();
    dvClose.focus();
    dvRenderer.load(url);
  }
  closeViewer = function () {
    if (!viewerOpen) return;
    viewerOpen = false;
    dvRenderer.clear();
    viewer.classList.remove("open");
    unlockScroll();
    if (dvLastFocus && dvLastFocus.focus) dvLastFocus.focus();
  };
  document.querySelectorAll("a.doc-link").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      openViewer(a.getAttribute("href"), a.getAttribute("data-doc-title"),
        a.getAttribute("data-download"), a.getAttribute("data-download-label"));
    });
  });
  dvClose.addEventListener("click", closeViewer);
  document.getElementById("dv-zoom-in").addEventListener("click", dvRenderer.zoomIn);
  document.getElementById("dv-zoom-out").addEventListener("click", dvRenderer.zoomOut);
}

// ---- Render lightbox ----
var grid = document.querySelector(".render-grid");
var lightbox = document.getElementById("lightbox");
var lbOpen = false;
var closeLightbox = function () {};
var lbIndex = 0;
var lbShow = function () {};
if (grid && lightbox) {
  var lbSrcs = Array.prototype.map.call(grid.querySelectorAll("button[data-src]"), function (b) { return b.getAttribute("data-src"); });
  var lbImg = document.getElementById("lb-img");
  var lbCount = document.getElementById("lb-count");
  var lbLastFocus = null;
  lbShow = function (i) {
    lbIndex = (i + lbSrcs.length) % lbSrcs.length;
    lbImg.src = lbSrcs[lbIndex];
    lbImg.alt = "Congomah Residence render " + (lbIndex + 1) + " of " + lbSrcs.length;
    lbCount.textContent = (lbIndex + 1) + " / " + lbSrcs.length;
  };
  function openLightbox(i) {
    lbLastFocus = document.activeElement;
    lbShow(i);
    lightbox.classList.add("open");
    lbOpen = true;
    lockScroll();
    var c = lightbox.querySelector(".m-close");
    if (c) c.focus();
  }
  closeLightbox = function () {
    if (!lbOpen) return;
    lbOpen = false;
    lightbox.classList.remove("open");
    unlockScroll();
    if (lbLastFocus && lbLastFocus.focus) lbLastFocus.focus();
  };
  grid.querySelectorAll("button[data-src]").forEach(function (b, i) {
    b.addEventListener("click", function () { openLightbox(i); });
  });
  document.getElementById("lb-prev").addEventListener("click", function () { lbShow(lbIndex - 1); });
  document.getElementById("lb-next").addEventListener("click", function () { lbShow(lbIndex + 1); });
  lightbox.querySelector(".m-close").addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", function (e) { if (e.target === lightbox) closeLightbox(); });
  var touchX = null;
  var lbMain = lightbox.querySelector(".gallery-main");
  lbMain.addEventListener("touchstart", function (e) { touchX = e.touches[0].clientX; }, { passive: true });
  lbMain.addEventListener("touchend", function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 40) { lbShow(dx < 0 ? lbIndex + 1 : lbIndex - 1); }
  }, { passive: true });
}

// ---- Keyboard ----
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    if (viewerOpen) { closeViewer(); return; }
    if (lbOpen) { closeLightbox(); return; }
    if (panelFullscreen) { setPanelFullscreen(false); return; }
    closeMenu();
  }
  if (lbOpen) {
    if (e.key === "ArrowLeft") lbShow(lbIndex - 1);
    if (e.key === "ArrowRight") lbShow(lbIndex + 1);
  }
});
