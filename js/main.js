(() => {
  const story = document.getElementById("scroll-story");
  const panels = document.getElementById("panels");
  const carMover = document.getElementById("car-mover");
  const carBundle = document.getElementById("car-bundle");
  const carEl = document.getElementById("car");
  const carRig = document.querySelector("#car .car-rig");
  const roadEl = document.querySelector(".road");
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
  const SNAP_MS = 720;
  const WHEEL_LOCK_MS = 780;
  const SWIPE_THRESHOLD = 48;
  /* Motif route : 28px trait + 20px vide = 48px */
  const ROAD_PATTERN_PX = 48;
  /* Lerp (0–1) : plus élevé = plus réactif */
  const LERP = 0.14;
  const LERP_FAST = 0.22;
  /* Distance px parcourue par « pas » de panneau (≈ fraction de la largeur route) */
  const TRAVEL_PX_PER_STEP = () => Math.max(160, (roadEl ? roadEl.clientWidth : window.innerWidth) * 0.42);
  const VELOCITY_ON = 8; /* px/s lissés — seuil moteur allumé */
  const SMOKE_IDLE_MS = 150;
  const LIGHTS_IDLE_MS = 1000;

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

  /* État animé continu (route + voiture : pas de reset brutal visible) */
  let targetLogical = 0;
  let smoothLogical = 0;
  let travelAbsPx = 0; /* distance cumulée en px (signe = sens) */
  let travelSmoothPx = 0;
  let roadOffsetPx = 0;
  let lightsLit = false;
  let smoking = false;
  let lastTs = 0;
  let lastMotionTs = 0;
  let smokeEndTimer = 0;
  let velocityPx = 0; /* vitesse lissée px/s */

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

  /**
   * Position X en px : boucle hors écran.
   * span = largeur route + largeur voiture.
   * mod 0 → x = -carW (entièrement à gauche, hors champ) ;
   * mod augmente → la voiture entre par la gauche, sort complètement à droite (x = roadW).
   */
  function carXFromTravel(travelPx) {
    const roadW = roadEl ? roadEl.clientWidth : window.innerWidth;
    const carW = carMover ? carMover.offsetWidth : carEl ? carEl.offsetWidth : 180;
    const span = Math.max(roadW + carW, 1);
    /* Décalage initial : ~4% de la route visible au chargement */
    const start = roadW * 0.04 + carW;
    const mod = (((start + travelPx) % span) + span) % span;
    return mod - carW;
  }

  /** Angle roue (deg) à partir de la distance px parcourue */
  function wheelAngleDeg(travelPx, diameterPct) {
    const carW = carMover ? carMover.offsetWidth : 180;
    const radiusPx = (diameterPct / 100) * carW * 0.5;
    if (radiusPx <= 0) return 0;
    return (travelPx / radiusPx) * (180 / Math.PI);
  }

  function setLights(on) {
    if (!carRig || reduce) return;
    if (lightsLit === on) return;
    lightsLit = on;
    carRig.classList.toggle("is-lit", on);
  }

  function setEngineSmoking(on, intensity) {
    if (!carBundle || reduce) return;
    if (on) {
      clearTimeout(smokeEndTimer);
      smoking = true;
      carBundle.classList.add("is-smoking");
      carBundle.classList.remove("is-smoke-ending");
      carBundle.style.setProperty("--smoke-intensity", String(clamp(intensity, 0.2, 0.85)));
      return;
    }
    if (!smoking) return;
    smoking = false;
    carBundle.classList.remove("is-smoking");
    carBundle.classList.add("is-smoke-ending");
    /* Laisse finir la puff en cours (~1,35 s) puis plus aucune fumée */
    clearTimeout(smokeEndTimer);
    smokeEndTimer = window.setTimeout(() => {
      if (!carBundle) return;
      carBundle.classList.remove("is-smoke-ending");
      carBundle.style.setProperty("--smoke-intensity", "0");
    }, 1400);
  }

  function applyVisuals() {
    if (carMover) {
      const x = carXFromTravel(travelSmoothPx);
      carMover.style.transform = `translate3d(${x}px, 0, 0)`;
    }

    if (!reduce) {
      const angF = wheelAngleDeg(travelSmoothPx, 10.6);
      const angR = wheelAngleDeg(travelSmoothPx, 11.2);
      if (wheelFront) wheelFront.style.transform = `rotate(${angF}deg)`;
      if (wheelRear) wheelRear.style.transform = `rotate(${angR}deg)`;

      if (roadStrip) {
        /* Modulo du motif : indépendant de la voiture, pas de saut visible */
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
      /* Un pas de panneau = avance continue (wrap hors écran géré par modulo) */
      travelAbsPx += delta * TRAVEL_PX_PER_STEP();
      lastMotionTs = performance.now();
      setLights(true);
    } else if (!animate) {
      smoothLogical = targetLogical;
      travelSmoothPx = travelAbsPx;
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

  /* Boucle rAF : lerp voyage, roues, route, moteur (fumée / phares) */
  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    const catchingUp = Math.abs(travelAbsPx - travelSmoothPx) > 0.5;
    const t = catchingUp ? LERP_FAST : LERP;

    const prevTravel = travelSmoothPx;
    smoothLogical = lerp(smoothLogical, targetLogical, t);
    travelSmoothPx = lerp(travelSmoothPx, travelAbsPx, t);

    const dTravel = travelSmoothPx - prevTravel;
    /* Vitesse lissée (px/s) pour seuil moteur */
    const instantVel = dt > 0 ? Math.abs(dTravel) / dt : 0;
    velocityPx = lerp(velocityPx, instantVel, 0.25);

    /* Route : même delta, modulo du motif — indépendant de la voiture */
    roadOffsetPx += dTravel;

    if (!reduce) {
      /* Moteur allumé tant que la voiture rattrape encore sa cible ou roule vraiment */
      const stillTraveling = Math.abs(travelAbsPx - travelSmoothPx) > 2;
      const engineOn = velocityPx > VELOCITY_ON || stillTraveling;
      if (engineOn) {
        lastMotionTs = ts;
        setLights(true);
        const intensity = clamp(0.35 + (velocityPx / 500) * 0.45, 0.35, 0.85);
        setEngineSmoking(true, intensity);
      } else {
        const idleFor = ts - lastMotionTs;
        /* Plus de nouvelles particules après ~150 ms sans mouvement */
        if (idleFor >= SMOKE_IDLE_MS) {
          setEngineSmoking(false, 0);
        }
        /* Phares s'éteignent ~1 s après l'arrêt */
        if (idleFor >= LIGHTS_IDLE_MS) {
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
