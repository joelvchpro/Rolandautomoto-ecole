(() => {
  const story = document.getElementById("scroll-story");
  const panels = document.getElementById("panels");
  const car = document.getElementById("car");
  const nav = document.getElementById("site-nav");
  const toggle = document.querySelector(".nav-toggle");
  const year = document.getElementById("year");
  const navLinks = nav ? [...nav.querySelectorAll("[data-panel]")] : [];

  if (year) year.textContent = String(new Date().getFullYear());

  /* Safari iOS: sync stage height to the visible viewport (toolbar safe) */
  function syncAppVh() {
    const vv = window.visualViewport;
    const h = vv && vv.height ? vv.height : window.innerHeight;
    if (!h) return;
    document.documentElement.style.setProperty("--app-vh", `${Math.round(h)}px`);
  }
  syncAppVh();
  window.addEventListener("resize", syncAppVh);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncAppVh);
    window.visualViewport.addEventListener("scroll", syncAppVh);
  }

  if (!story || !panels) return;

  const REAL_COUNT = 4;
  const REAL_MAX = REAL_COUNT - 1;
  const CAR_START = 4;
  const CAR_TRAVEL = 78;
  const SNAP_MS = 620;
  const WHEEL_LOCK_MS = 700;
  const SWIPE_THRESHOLD = 48;

  const originals = [...panels.querySelectorAll(":scope > .panel")];
  originals.forEach((el, i) => {
    el.dataset.logical = String(i);
    el.dataset.trackRole = "real";
  });

  function clonePanel(source, role) {
    const node = source.cloneNode(true);
    node.removeAttribute("id");
    node.setAttribute("aria-hidden", "true");
    node.dataset.trackRole = role;
    node.dataset.logical = source.dataset.logical;
    node.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    return node;
  }

  const headClone = clonePanel(originals[originals.length - 1], "head-clone");
  const tailClone = clonePanel(originals[0], "tail-clone");
  panels.insertBefore(headClone, panels.firstChild);
  panels.appendChild(tailClone);

  const trackPanels = [...panels.querySelectorAll(":scope > .panel")];
  const TRACK_COUNT = trackPanels.length; // 6
  const TRACK_MAX = TRACK_COUNT - 1; // 5
  // 0=contact-clone, 1=hero, 2=services, 3=history, 4=contact, 5=hero-clone
  const FIRST_REAL = 1;
  const LAST_REAL = REAL_COUNT; // 4

  panels.style.width = `${TRACK_COUNT * 100}%`;
  trackPanels.forEach((el) => {
    el.style.flex = `0 0 ${100 / TRACK_COUNT}%`;
    el.style.width = `${100 / TRACK_COUNT}%`;
  });

  // Tall story kept for layout/footer; navigation is index-snapped (not free scroll)
  story.style.height = `${TRACK_COUNT * 100}vh`;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let trackIndex = FIRST_REAL;
  let animating = false;
  let wheelLocked = false;
  let wrapTimer = 0;

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function logicalFromTrackIndex(i) {
    if (i <= 0) return REAL_MAX;
    if (i >= TRACK_MAX) return 0;
    return clamp(i - FIRST_REAL, 0, REAL_MAX);
  }

  function applyCar(logicalFloat) {
    if (!car) return;
    const p = clamp(logicalFloat / REAL_MAX, 0, 1);
    car.style.left = `${CAR_START + p * CAR_TRAVEL}%`;
  }

  function applyTrack(index, { animate = true } = {}) {
    trackIndex = index;
    const xPercent = index * (100 / TRACK_COUNT);
    if (!animate || reduce) {
      panels.style.transition = "none";
    } else {
      panels.style.transition = `transform ${SNAP_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    }
    panels.style.transform = `translate3d(-${xPercent}%, 0, 0)`;

    const logical = logicalFromTrackIndex(index);
    // During wrap animation from contact→hero-clone, car eases toward start
    let carLogical = logical;
    if (index === TRACK_MAX) carLogical = 0;
    if (index === 0) carLogical = REAL_MAX;
    // Interpolate car for mid transition? Snap car to destination logical of target
    if (index > LAST_REAL) carLogical = 0;
    else if (index < FIRST_REAL) carLogical = REAL_MAX;
    else carLogical = index - FIRST_REAL;
    applyCar(carLogical);

    document.body.classList.toggle("is-hero", logical === 0);

    trackPanels.forEach((el, i) => {
      el.classList.toggle("is-active-panel", i === index);
      el.classList.toggle("is-away", i !== index);
    });

    navLinks.forEach((link) => {
      const idx = Number(link.dataset.panel);
      link.classList.toggle("is-active", idx === logical && logical > 0);
    });

    // Keep window scroll roughly in sync (for address bar / a11y), without fighting snap
    const total = Math.max(story.offsetHeight - window.innerHeight, 1);
    const top = story.offsetTop + (index / TRACK_MAX) * total;
    if (Math.abs(window.scrollY - top) > 2) {
      window.scrollTo({ top, behavior: "auto" });
    }
  }

  function finishWrapIfNeeded() {
    if (trackIndex >= TRACK_MAX) {
      applyTrack(FIRST_REAL, { animate: false });
      // force reflow so next animate works
      void panels.offsetWidth;
      panels.style.transition = `transform ${SNAP_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    } else if (trackIndex <= 0) {
      applyTrack(LAST_REAL, { animate: false });
      void panels.offsetWidth;
      panels.style.transition = `transform ${SNAP_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    }
    animating = false;
  }

  function goBy(dir) {
    if (animating || reduce) return;
    const next = trackIndex + dir;
    if (next < 0 || next > TRACK_MAX) return;

    animating = true;
    applyTrack(next, { animate: true });

    clearTimeout(wrapTimer);
    wrapTimer = window.setTimeout(finishWrapIfNeeded, SNAP_MS + 30);
  }

  function goToLogical(logicalIndex) {
    const target = FIRST_REAL + clamp(logicalIndex, 0, REAL_MAX);
    if (target === trackIndex) return;
    if (animating) return;
    animating = true;
    applyTrack(target, { animate: !reduce });
    clearTimeout(wrapTimer);
    wrapTimer = window.setTimeout(() => {
      animating = false;
    }, reduce ? 0 : SNAP_MS + 30);
  }

  function normalizeWheelDelta(e) {
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    } else if (e.deltaMode === 2) {
      dx *= window.innerHeight;
      dy *= window.innerHeight;
    }
    return { dx, dy };
  }

  function onWheel(e) {
    if (reduce) return;
    e.preventDefault();
    if (animating || wheelLocked) return;

    const { dx, dy } = normalizeWheelDelta(e);
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < 6 && absY < 6) return;

    const delta = absX >= absY ? dx : dy;
    const dir = delta > 0 ? 1 : -1;

    wheelLocked = true;
    goBy(dir);
    window.setTimeout(() => {
      wheelLocked = false;
    }, WHEEL_LOCK_MS);
  }

  // Touch / pointer: one swipe = one panel
  let swipe = null;

  function onPointerDown(e) {
    if (reduce || e.pointerType === "mouse") return;
    swipe = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      decided: false,
    };
  }

  function onPointerMove(e) {
    if (!swipe || swipe.id !== e.pointerId || swipe.decided || animating) return;
    const dx = swipe.x - e.clientX;
    const dy = swipe.y - e.clientY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < SWIPE_THRESHOLD && absY < SWIPE_THRESHOLD) return;

    swipe.decided = true;
    e.preventDefault();
    const delta = absX >= absY ? dx : dy;
    goBy(delta > 0 ? 1 : -1);
  }

  function onPointerUp(e) {
    if (swipe && swipe.id === e.pointerId) swipe = null;
  }

  let touchStart = null;
  function onTouchStart(e) {
    if (reduce || !e.touches[0]) return;
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, decided: false };
  }
  function onTouchMove(e) {
    if (!touchStart || touchStart.decided || animating || !e.touches[0]) return;
    const t = e.touches[0];
    const dx = touchStart.x - t.clientX;
    const dy = touchStart.y - t.clientY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < SWIPE_THRESHOLD && absY < SWIPE_THRESHOLD) return;
    touchStart.decided = true;
    e.preventDefault();
    const delta = absX >= absY ? dx : dy;
    goBy(delta > 0 ? 1 : -1);
  }
  function onTouchEnd() {
    touchStart = null;
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const idx = Number(link.dataset.panel);
      if (!Number.isNaN(idx)) goToLogical(idx);
      if (nav) nav.classList.remove("is-open");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    });
  });

  document.querySelectorAll(".cta[data-panel]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const idx = Number(link.dataset.panel);
      if (!Number.isNaN(idx)) goToLogical(idx);
    });
  });

  document.querySelectorAll('.brand[href="#top"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      goToLogical(0);
    });
  });

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("is-open", !open);
    });
  }

  // Block free native scrolling of the story; snap owns navigation
  function onScrollLock() {
    if (animating) return;
    const total = Math.max(story.offsetHeight - window.innerHeight, 1);
    const expected = story.offsetTop + (trackIndex / TRACK_MAX) * total;
    if (Math.abs(window.scrollY - expected) > 8) {
      window.scrollTo({ top: expected, behavior: "auto" });
    }
  }

  if (reduce) {
    applyTrack(FIRST_REAL, { animate: false });
    document.body.classList.add("is-hero");
  } else {
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", onScrollLock, { passive: true });
    if (window.PointerEvent) {
      window.addEventListener("pointerdown", onPointerDown, { passive: true });
      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp, { passive: true });
      window.addEventListener("pointercancel", onPointerUp, { passive: true });
    } else {
      window.addEventListener("touchstart", onTouchStart, { passive: true });
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("touchend", onTouchEnd, { passive: true });
      window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    }
    window.addEventListener("resize", () => {
      syncAppVh();
      applyTrack(trackIndex, { animate: false });
    });
    applyTrack(FIRST_REAL, { animate: false });
  }
})();
