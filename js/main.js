(() => {
  const story = document.getElementById("scroll-story");
  const panels = document.getElementById("panels");
  const carMover = document.getElementById("car-mover");
  const carRig = document.querySelector("#car .car-rig");
  const roadStrip = document.getElementById("road-line-strip");
  const wheelFront = document.getElementById("wheel-front");
  const wheelRear = document.getElementById("wheel-rear");
  const nav = document.getElementById("site-nav");
  const toggle = document.querySelector(".nav-toggle");
  const year = document.getElementById("year");
  const navLinks = nav ? [...nav.querySelectorAll("[data-panel]")] : [];

  if (year) year.textContent = String(new Date().getFullYear());

  /* Safari iOS : hauteur visible (barre du bas) */
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
  const CAR_START = 4; /* % de la largeur de route */
  const CAR_TRAVEL = 78;
  const SNAP_MS = 720;
  const WHEEL_LOCK_MS = 780;
  const SWIPE_THRESHOLD = 48;
  /* Motif route : 28px trait + 20px vide = 48px */
  const ROAD_PATTERN_PX = 48;
  /* Lerp (0–1) : plus élevé = plus réactif */
  const LERP = 0.14;
  const LERP_FAST = 0.22;

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
  const TRACK_COUNT = trackPanels.length;
  const TRACK_MAX = TRACK_COUNT - 1;
  const FIRST_REAL = 1;
  const LAST_REAL = REAL_COUNT;

  panels.style.width = `${TRACK_COUNT * 100}%`;
  trackPanels.forEach((el) => {
    el.style.flex = `0 0 ${100 / TRACK_COUNT}%`;
    el.style.width = `${100 / TRACK_COUNT}%`;
  });

  story.style.height = `${TRACK_COUNT * 100}vh`;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let trackIndex = FIRST_REAL;
  let animating = false;
  let wheelLocked = false;
  let wrapTimer = 0;

  /* État animé continu (jamais de reset brutal pour la route) */
  let targetLogical = 0;
  let smoothLogical = 0;
  let travelAbs = 0; /* distance cumulée en « unités route » (0–1 ≈ plein parcours) */
  let travelSmooth = 0;
  let roadOffsetPx = 0;
  let lightsLit = false;
  let smoking = false;
  let smokeIntensity = 0;
  let lastTs = 0;
  let movingUntil = 0;

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function logicalFromTrackIndex(i) {
    if (i <= 0) return REAL_MAX;
    if (i >= TRACK_MAX) return 0;
    return clamp(i - FIRST_REAL, 0, REAL_MAX);
  }

  function carXFromLogical(logicalFloat) {
    const p = clamp(logicalFloat / REAL_MAX, 0, 1);
    return CAR_START + p * CAR_TRAVEL;
  }

  /** Rayon roue en % de largeur voiture → angle (deg) pour une distance route en % */
  function wheelAngleDeg(travelUnits, diameterPct) {
    /* 1 travelUnit ≈ déplacement car de CAR_TRAVEL% de la route.
       Approximation : distance px ≈ travelUnits * largeur_route * (CAR_TRAVEL/100)
       Rayon roue ≈ (diameterPct/100) * largeur_voiture / 2
       On exprime tout en fraction de largeur voiture : la voiture fait ~36vw max,
       la route 100vw → facteur ~100/36. On simplifie avec un facteur stable. */
    const roadToCar = 100 / 34; /* largeur route / largeur voiture approx */
    const distInCarWidths = travelUnits * (CAR_TRAVEL / 100) * roadToCar;
    const radius = diameterPct / 100 / 2;
    if (radius <= 0) return 0;
    /* sens : avance vers la droite → rotation horaire (négatif en CSS = sens antihoraire,
       pour roues vues de ce côté : avance = rotation horaire = positif) */
    return (distInCarWidths / radius) * (180 / Math.PI);
  }

  function setLights(on) {
    if (!carRig || reduce) return;
    if (lightsLit === on) return;
    lightsLit = on;
    carRig.classList.toggle("is-lit", on);
  }

  function setSmoke(on, intensity) {
    if (!carRig || reduce) return;
    smoking = on;
    smokeIntensity = intensity;
    carRig.classList.toggle("is-smoking", on && intensity > 0.05);
    carRig.style.setProperty("--smoke-intensity", String(clamp(intensity, 0, 0.85)));
  }

  function applyVisuals() {
    if (carMover) {
      const x = carXFromLogical(smoothLogical);
      carMover.style.transform = `translate3d(${x}%, 0, 0)`;
    }

    if (!reduce) {
      const angF = wheelAngleDeg(travelSmooth, 10.6);
      const angR = wheelAngleDeg(travelSmooth, 11.2);
      if (wheelFront) wheelFront.style.transform = `rotate(${angF}deg)`;
      if (wheelRear) wheelRear.style.transform = `rotate(${angR}deg)`;

      if (roadStrip) {
        /* Modulo du motif : pas de saut visible */
        const mod = ((roadOffsetPx % ROAD_PATTERN_PX) + ROAD_PATTERN_PX) % ROAD_PATTERN_PX;
        roadStrip.style.transform = `translate3d(${-mod}px, 0, 0)`;
      }
    }

    const logical = logicalFromTrackIndex(trackIndex);
    document.body.classList.toggle("is-hero", logical === 0);

    trackPanels.forEach((el, i) => {
      el.classList.toggle("is-active-panel", i === trackIndex);
      el.classList.toggle("is-away", i !== trackIndex);
    });

    navLinks.forEach((link) => {
      const idx = Number(link.dataset.panel);
      link.classList.toggle("is-active", idx === logical && logical > 0);
    });
  }

  function syncWindowScroll() {
    const total = Math.max(story.offsetHeight - window.innerHeight, 1);
    const top = story.offsetTop + (trackIndex / TRACK_MAX) * total;
    if (Math.abs(window.scrollY - top) > 2) {
      window.scrollTo({ top, behavior: "auto" });
    }
  }

  function applyTrack(index, { animate = true, fromLogical = null } = {}) {
    const prevLogical =
      fromLogical != null
        ? fromLogical
        : trackIndex >= FIRST_REAL && trackIndex <= LAST_REAL
          ? trackIndex - FIRST_REAL
          : logicalFromTrackIndex(trackIndex);

    trackIndex = index;
    const xPercent = index * (100 / TRACK_COUNT);

    if (!animate || reduce) {
      panels.style.transition = "none";
    } else {
      panels.style.transition = `transform ${SNAP_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    }
    panels.style.transform = `translate3d(-${xPercent}%, 0, 0)`;

    let carLogical;
    if (index === TRACK_MAX) carLogical = 0;
    else if (index === 0) carLogical = REAL_MAX;
    else if (index > LAST_REAL) carLogical = 0;
    else if (index < FIRST_REAL) carLogical = REAL_MAX;
    else carLogical = index - FIRST_REAL;

    targetLogical = carLogical;

    /* Distance parcourue pour les roues / route (signe = sens) */
    let delta = carLogical - prevLogical;
    /* Wrap contact → hero : on compte comme continuer vers l'avant */
    if (index === TRACK_MAX || (prevLogical === REAL_MAX && carLogical === 0 && index === FIRST_REAL)) {
      delta = 1; /* une « marche » vers l'avant */
      targetLogical = 0;
    } else if (index === 0 || (prevLogical === 0 && carLogical === REAL_MAX && index === LAST_REAL)) {
      delta = -1;
      targetLogical = REAL_MAX;
    }

    if (!reduce && animate) {
      travelAbs += delta;
      movingUntil = performance.now() + SNAP_MS + 80;
      setLights(true);
      setSmoke(true, Math.min(0.75, 0.35 + Math.abs(delta) * 0.25));
    } else if (!animate) {
      smoothLogical = targetLogical;
      travelSmooth = travelAbs;
    }

    syncWindowScroll();
    if (!animate) applyVisuals();
  }

  function finishWrapIfNeeded() {
    if (trackIndex >= TRACK_MAX) {
      applyTrack(FIRST_REAL, { animate: false, fromLogical: 0 });
      void panels.offsetWidth;
      panels.style.transition = `transform ${SNAP_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    } else if (trackIndex <= 0) {
      applyTrack(LAST_REAL, { animate: false, fromLogical: REAL_MAX });
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

  let swipe = null;

  function onPointerDown(e) {
    if (reduce || e.pointerType === "mouse") return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, decided: false };
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

  function onScrollLock() {
    if (animating) return;
    const total = Math.max(story.offsetHeight - window.innerHeight, 1);
    const expected = story.offsetTop + (trackIndex / TRACK_MAX) * total;
    if (Math.abs(window.scrollY - expected) > 8) {
      window.scrollTo({ top: expected, behavior: "auto" });
    }
  }

  /* Boucle rAF : lerp position voiture, angle roues, défilement route */
  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    const moving = ts < movingUntil;
    const t = moving ? LERP_FAST : LERP;

    const prevTravel = travelSmooth;
    smoothLogical = lerp(smoothLogical, targetLogical, t);
    travelSmooth = lerp(travelSmooth, travelAbs, t);

    const dTravel = travelSmooth - prevTravel;
    /* Route : conversion unités → pixels (approx largeur viewport) */
    roadOffsetPx += dTravel * (CAR_TRAVEL / 100) * window.innerWidth * 0.85;

    if (!reduce) {
      if (moving) {
        setLights(true);
        const speed = Math.min(1, Math.abs(dTravel) / Math.max(dt, 0.001) / 2.5);
        setSmoke(true, 0.25 + speed * 0.55);
      } else {
        /* Extinction douce au repos ; phares off seulement tout en haut */
        setSmoke(false, 0);
        if (Math.abs(smoothLogical) < 0.02 && Math.abs(targetLogical) < 0.02) {
          setLights(false);
        }
      }
    }

    applyVisuals();
    requestAnimationFrame(tick);
  }

  if (reduce) {
    applyTrack(FIRST_REAL, { animate: false });
    document.body.classList.add("is-hero");
    applyVisuals();
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
    requestAnimationFrame(tick);
  }
})();
