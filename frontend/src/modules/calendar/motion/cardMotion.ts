/**
 * Card motion: what happens to a task card while it is saved, moved, created,
 * deleted or parked, and how it travels between the grid and the «Сьогодні» panel.
 *
 * An *intent* is one user action on a set of keys (event id, task id). It lives
 * from the action until its animation ends. Cards and panel rows carry
 * `data-motion-keys`; `useMotionPresence` reports what appeared, left or moved,
 * and this module decides how to animate it with the Web Animations API.
 * Ghosts are DOM clones in one fixed layer above the page, so a card can fly
 * from a panel row or a sheet into the grid.
 */
import type { MutationStage } from '../../schedule/taskMutationProgress';
import {
  boxMoved,
  offscreenDirection,
  splitKeys,
  springEasing,
  stageProgress,
  travelTransform,
  type Box,
  type EdgeDirection,
} from './motionMath';

export type MotionKind = 'move' | 'edit' | 'create' | 'delete' | 'place';
/** Panel section an action started from (where a card comes from when its row is not on screen). */
export type MotionFrom = 'later' | 'problems';
export type MotionOutcome = 'done' | 'error' | 'cancel';
export type MotionTarget = 'problems' | 'later' | 'today';

/** Where a task went, read from the latest task list (`gone`: no longer on the calendar, e.g. done). */
export type MotionDestination =
  | { type: 'date'; startMs: number }
  | { type: 'parked' }
  | { type: 'later' }
  | { type: 'gone' }
  | null;

/** How a card looks while its intent is in flight (CSS reads `data-motion`). */
export type CardMotionState = 'forming' | 'busy' | 'erasing';

type GhostRole = 'emptying' | 'held';

type Intent = {
  id: number;
  kind: MotionKind;
  keys: Set<string>;
  from?: MotionFrom;
  targetMs?: number;
  outcome?: MotionOutcome;
  settledAt?: number;
  ghost?: HTMLElement;
  ghostBox?: Box;
  ghostRole?: GhostRole;
  animating: boolean;
  timer?: ReturnType<typeof setTimeout>;
  watch?: ReturnType<typeof setTimeout>;
  /** When the current ghost started waiting for its destination. */
  heldAt?: number;
};

export type MotionHandle = {
  addKey: (key: string | null | undefined) => void;
  settle: (outcome: MotionOutcome, details?: { targetMs?: number }) => void;
};

export type PresenceEntry = { el: HTMLElement; keys: string[]; box: Box };
export type PresenceMove = PresenceEntry & { from: Box };

export type PresenceChange = {
  removed: PresenceEntry[];
  added: PresenceEntry[];
  moved: PresenceMove[];
};

/** A settled intent waits this long for the card to show up at its new place. */
const SETTLE_WAIT_MS = 1600;
const WATCH_MS = 250;
/** After the animation, keep the intent briefly so a late refetch still animates as this action. */
const LINGER_MS = 4000;
/** No server answer this long: drop the ghost rather than leave it on screen. */
const STALE_MS = 20_000;

const FLIGHT_MS = 600;
const FLIP_MS = 380;
const ENTER_MS = 360;
const WIPE_MS = 420;
const FADE_MS = 180;

const SPRING = springEasing(0.2);
const SOFT_SPRING = springEasing(0.08);
/** Flights between places: a visible glide, a small overshoot on landing. */
const FLIGHT_SPRING = springEasing(0.15, 1.05);
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

let nextId = 1;
const intents = new Set<Intent>();
const listeners = new Set<() => void>();
let epoch = 0;
let visibleRange: { startMs: number; endMs: number } | null = null;
let resolveDestination: (keys: string[]) => MotionDestination = () => null;
let formatEdgeLabel: (startMs: number) => string = (ms) => new Date(ms).toLocaleDateString();
let stageOf: (key: string) => MutationStage | null = () => null;

function notify() {
  epoch += 1;
  for (const cb of listeners) cb();
}

export function subscribeMotion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMotionEpoch(): number {
  return epoch;
}

/** The calendar tells the engine what is on screen and how to read where a task went. */
export function configureMotion(options: {
  range?: { startMs: number; endMs: number } | null;
  resolve?: (keys: string[]) => MotionDestination;
  edgeLabel?: (startMs: number) => string;
}) {
  if (options.range !== undefined) visibleRange = options.range;
  if (options.resolve) resolveDestination = options.resolve;
  if (options.edgeLabel) formatEdgeLabel = options.edgeLabel;
}

/** taskMutationProgress registers its stage lookup here (avoids an import cycle). */
export function setMotionStageSource(source: (key: string) => MutationStage | null) {
  stageOf = source;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function canAnimate(el: Element): el is HTMLElement {
  return typeof (el as HTMLElement).animate === 'function';
}

function findIntent(keys: Iterable<string>): Intent | undefined {
  const list = Array.from(keys);
  if (!list.length) return undefined;
  let found: Intent | undefined;
  for (const intent of intents) {
    if (list.some((key) => intent.keys.has(key))) {
      // The newest action on these keys wins.
      if (!found || intent.id > found.id) found = intent;
    }
  }
  return found;
}

/**
 * Start (or join) the motion for an action. A second tracker on keys that an
 * active intent already holds joins it without widening its keys: a drag of
 * one series day must not light up the whole series.
 */
export function trackMotion(options: {
  keys: Array<string | null | undefined>;
  kind: MotionKind;
  from?: MotionFrom;
  targetMs?: number;
}): MotionHandle {
  const keys = options.keys.filter((key): key is string => !!key);
  const existing = findIntent(keys);
  const intent: Intent =
    existing && !existing.outcome
      ? existing
      : {
          id: nextId++,
          kind: options.kind,
          keys: new Set(keys),
          from: options.from,
          targetMs: options.targetMs,
          animating: false,
        };
  if (intent !== existing) {
    intents.add(intent);
    scheduleStale(intent);
    notify();
  } else if (options.targetMs != null && intent.targetMs == null) {
    intent.targetMs = options.targetMs;
  }
  return {
    addKey: (key) => {
      if (!key || intent.keys.has(key)) return;
      intent.keys.add(key);
      notify();
    },
    settle: (outcome, details) => settleIntent(intent, outcome, details),
  };
}

function settleIntent(intent: Intent, outcome: MotionOutcome, details?: { targetMs?: number }) {
  if (!intents.has(intent) || intent.outcome) return;
  intent.outcome = outcome;
  intent.settledAt = Date.now();
  if (details?.targetMs != null) intent.targetMs = details.targetMs;
  notify();
  if (outcome === 'done' && !intent.ghost && intent.kind === 'edit') pulseIfStill(intent);
  watchGhost(intent);
  scheduleCleanup(intent);
}

function scheduleStale(intent: Intent) {
  setTimeout(() => {
    if (!intents.has(intent) || intent.outcome) return;
    settleIntent(intent, 'cancel');
  }, STALE_MS);
}

function scheduleCleanup(intent: Intent) {
  clearTimeout(intent.timer);
  intent.timer = setTimeout(() => {
    if (intent.animating || intent.ghost) {
      scheduleCleanup(intent);
      return;
    }
    intents.delete(intent);
    notify();
  }, LINGER_MS);
}

/** Card look while its action runs; null when it should look normal. */
export function cardMotionState(keys: string[]): CardMotionState | null {
  const intent = findIntent(keys);
  if (!intent) return null;
  // A deleted card stays crossed out until the refetch takes it away.
  if (intent.kind === 'delete') return intent.outcome && intent.outcome !== 'done' ? null : 'erasing';
  if (intent.outcome) return null;
  if (intent.kind === 'move' && intent.ghost) return 'forming';
  if (intent.kind === 'create') return 'forming';
  return 'busy';
}

/** Stage of the action on these keys, for the progress fill. */
export function cardMotionStage(keys: string[]): MutationStage | null {
  const intent = findIntent(keys);
  if (!intent || intent.outcome) return null;
  for (const key of intent.keys) {
    const stage = stageOf(key);
    if (stage) return stage;
  }
  return 'saving';
}

/** A card being moved cannot be picked up again until its flight lands. */
export function isMotionLocked(keys: string[]): boolean {
  const intent = findIntent(keys);
  if (!intent) return false;
  return !intent.outcome || intent.animating;
}

/** Tasks just created whose card should already stand on the grid. */
export function isCreatePending(taskId: string): boolean {
  const intent = findIntent([taskId]);
  return !!intent && intent.kind === 'create' && !intent.outcome;
}

/** Stage change for some keys: repaint ghosts that belong to them. */
export function noteMotionStage() {
  for (const intent of intents) {
    if (!intent.ghost) continue;
    const stage = cardMotionStage(Array.from(intent.keys));
    if (stage) applyStageAttrs(intent.ghost, stage);
  }
}

function applyStageAttrs(el: HTMLElement, stage: MutationStage) {
  el.dataset.motionStage = stage;
  el.style.setProperty('--motion-p', String(stageProgress(stage)));
}

// ---------------------------------------------------------------- ghost layer

let layer: HTMLDivElement | null = null;

function ghostLayer(): HTMLDivElement {
  if (layer && document.body.contains(layer)) return layer;
  layer = document.createElement('div');
  layer.className = 'motion-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

function stripIdentity(el: Element) {
  el.removeAttribute('id');
  el.removeAttribute('data-testid');
  el.removeAttribute('data-motion-keys');
  el.removeAttribute('tabindex');
  el.removeAttribute('role');
  for (const child of Array.from(el.children)) stripIdentity(child);
}

/** A non-interactive copy of `el` drawn at `box` (viewport coordinates). */
function makeGhost(el: HTMLElement, box: Box): HTMLElement {
  const ghost = el.cloneNode(true) as HTMLElement;
  stripIdentity(ghost);
  ghost.classList.add('motion-ghost');
  ghost.removeAttribute('data-motion');
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    right: 'auto',
    bottom: 'auto',
    margin: '0',
    transform: 'none',
    transformOrigin: '50% 50%',
    zIndex: '1',
  });
  ghostLayer().appendChild(ghost);
  return ghost;
}

function viewportBox(el: Element): Box {
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function isShown(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findCard(intent: Intent, near?: Box): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const all = Array.from(document.querySelectorAll<HTMLElement>('[data-motion-keys]'));
  const matches = all.filter(
    (el) => isShown(el) && splitKeys(el.dataset.motionKeys).some((key) => intent.keys.has(key)),
  );
  if (matches.length <= 1 || !near) return matches[0] ?? null;
  // A series: land on the copy closest to where the ghost is.
  let best = matches[0];
  let bestDist = Infinity;
  for (const el of matches) {
    const box = viewportBox(el);
    const dist = Math.hypot(box.left - near.left, box.top - near.top);
    if (dist < bestDist) {
      best = el;
      bestDist = dist;
    }
  }
  return best;
}

function findTarget(name: MotionTarget): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const order: MotionTarget[] = name === 'today' ? ['today'] : [name, 'today'];
  for (const item of order) {
    const el = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-motion-target~="${item}"]`),
    ).find(isShown);
    if (el) return el;
  }
  return null;
}

function findEdge(direction: EdgeDirection): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(`[data-motion-edge="${direction}"]`)).find(
      isShown,
    ) ?? null
  );
}

// ---------------------------------------------------------------- animations

function play(
  el: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Promise<void> {
  if (!canAnimate(el)) return Promise.resolve();
  const animation = el.animate(keyframes, { fill: 'both', ...options });
  return animation.finished.then(
    () => {
      // Hand the element back to its stylesheet.
      animation.cancel();
    },
    () => undefined,
  );
}

/** A ghost's animation ended: drop it, unless the intent has moved on to another ghost. */
function finishGhost(intent: Intent, ghost: HTMLElement) {
  ghost.remove();
  if (intent.ghost !== ghost) return;
  intent.animating = false;
  intent.ghost = undefined;
  intent.ghostBox = undefined;
  intent.ghostRole = undefined;
  notify();
}

function transformTo(from: Box, to: Box, min = 0.15, max = 1.2): string {
  return travelTransform(to, from, min, max);
}

function centerBox(box: Box, size: number): Box {
  return {
    left: box.left + box.width / 2 - size / 2,
    top: box.top + box.height / 2 - size / 2,
    width: size,
    height: size,
  };
}

function pulse(el: HTMLElement) {
  if (prefersReducedMotion()) return;
  el.classList.remove('motion-pulse');
  // Restart the keyframes if it is already pulsing.
  void el.offsetWidth;
  el.classList.add('motion-pulse');
  setTimeout(() => el.classList.remove('motion-pulse'), 700);
}

/** Card lands: a short overshoot so the eye catches where it went. */
function settleCard(el: HTMLElement) {
  if (prefersReducedMotion()) return;
  void play(
    el,
    [
      { transform: 'scale(1.035)', transformOrigin: '50% 50%' },
      { transform: 'scale(1)', transformOrigin: '50% 50%' },
    ],
    { duration: 320, easing: SPRING, fill: 'none' },
  );
}

/** A new card unfolds down from its start line. */
function enterCard(el: HTMLElement) {
  if (prefersReducedMotion()) {
    void play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, fill: 'none' });
    return;
  }
  void play(
    el,
    [
      { clipPath: 'inset(0 0 100% 0 round 6px)', opacity: 0.2, transform: 'translateY(-2px)' },
      { clipPath: 'inset(0 0 0 0 round 6px)', opacity: 1, transform: 'none' },
    ],
    { duration: ENTER_MS, easing: SOFT_SPRING, fill: 'none' },
  );
}

/**
 * Layout change (another card's move pushed this one, a resize, a form edit):
 * slide from the old place. Only the position travels; a new size fades in.
 */
function flipCard(el: HTMLElement, from: Box, to: Box, lifted = false) {
  if (prefersReducedMotion()) return Promise.resolve();
  const start = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
  const resized = Math.abs(from.width - to.width) > 4 || Math.abs(from.height - to.height) > 4;
  const first: Keyframe = { transform: start, opacity: resized ? 0.55 : 1 };
  const frames: Keyframe[] = lifted
    ? [
        { ...first, boxShadow: 'var(--motion-lift-shadow)' },
        { transform: 'none', opacity: 1, boxShadow: 'var(--motion-lift-shadow)', offset: 0.85 },
        { transform: 'none', opacity: 1 },
      ]
    : [first, { transform: 'none', opacity: 1 }];
  return play(el, frames, {
    duration: lifted ? FLIGHT_MS : FLIP_MS,
    easing: lifted ? FLIGHT_SPRING : SOFT_SPRING,
    fill: 'none',
  });
}

function fadeGhost(intent: Intent) {
  const ghost = intent.ghost;
  if (!ghost) return;
  intent.animating = true;
  void play(ghost, [{ opacity: 1 }, { opacity: 0, transform: 'scale(0.96)' }], {
    duration: FADE_MS,
    easing: EASE_IN,
  }).then(() => {
    finishGhost(intent, ghost);
  });
}

function fadeOutCopy(el: HTMLElement, box: Box) {
  const ghost = makeGhost(el, box);
  void play(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS }).then(() =>
    ghost.remove(),
  );
}

const WIPE_FRAMES: Keyframe[] = [
  { clipPath: 'inset(0 0 0 0 round 6px)', filter: 'blur(0px)', opacity: 1 },
  { clipPath: 'inset(0 0 0 35% round 6px)', filter: 'blur(0.5px)', opacity: 0.9, offset: 0.35 },
  { clipPath: 'inset(0 0 0 100% round 6px)', filter: 'blur(2px)', opacity: 0.3 },
];
const WIPE_EASING = 'cubic-bezier(0.55, 0, 0.75, 0.6)';

/** «Стирається»: an eraser sweeps the card away from the left. */
function wipeGhost(intent: Intent) {
  const ghost = intent.ghost;
  if (!ghost) return;
  if (prefersReducedMotion()) {
    fadeGhost(intent);
    return;
  }
  intent.animating = true;
  ghost.dataset.motion = 'erasing';
  void play(ghost, WIPE_FRAMES, { duration: WIPE_MS, easing: WIPE_EASING }).then(() => {
    finishGhost(intent, ghost);
  });
}

function wipeCopy(el: HTMLElement, box: Box) {
  if (prefersReducedMotion()) {
    fadeOutCopy(el, box);
    return;
  }
  const ghost = makeGhost(el, box);
  ghost.dataset.motion = 'erasing';
  void play(ghost, WIPE_FRAMES, { duration: WIPE_MS, easing: WIPE_EASING }).then(() => ghost.remove());
}

/** Ghost lifts off and shrinks into a button or counter, which pulses. */
function flyGhostInto(intent: Intent, target: HTMLElement, after?: () => void) {
  const ghost = intent.ghost;
  const from = intent.ghostBox;
  if (!ghost || !from) return;
  if (prefersReducedMotion()) {
    fadeGhost(intent);
    after?.();
    return;
  }
  intent.animating = true;
  const to = centerBox(viewportBox(target), 18);
  const mid: Box = {
    left: from.left + (to.left - from.left) * 0.25,
    top: from.top + (to.top - from.top) * 0.25 - 12,
    width: from.width * 1.04,
    height: from.height * 1.04,
  };
  void play(
    ghost,
    [
      { transform: 'none', opacity: 1, boxShadow: 'none' },
      { transform: transformTo(from, mid), opacity: 1, boxShadow: 'var(--motion-lift-shadow)', offset: 0.25 },
      { transform: transformTo(from, to), opacity: 0.15, boxShadow: 'none' },
    ],
    { duration: FLIGHT_MS + 80, easing: 'cubic-bezier(0.5, 0, 0.3, 1)' },
  ).then(() => {
    finishGhost(intent, ghost);
    pulse(target);
    after?.();
  });
}

/** Off the visible days: fly to the pagination arrow and say which day it went to. */
function flyGhostToEdge(intent: Intent, direction: EdgeDirection, startMs: number) {
  const edge = findEdge(direction);
  if (edge) {
    flyGhostInto(intent, edge, () => showEdgeLabel(edge, direction, startMs));
    return;
  }
  const ghost = intent.ghost;
  if (!ghost || prefersReducedMotion()) {
    fadeGhost(intent);
    return;
  }
  intent.animating = true;
  const dx = direction === 'next' ? window.innerWidth : -window.innerWidth;
  void play(
    ghost,
    [
      { transform: 'none', opacity: 1 },
      { transform: `translateX(${dx * 0.6}px) scale(0.9)`, opacity: 0 },
    ],
    { duration: FLIGHT_MS, easing: EASE_IN },
  ).then(() => {
    finishGhost(intent, ghost);
  });
}

function showEdgeLabel(edge: HTMLElement, direction: EdgeDirection, startMs: number) {
  const box = viewportBox(edge);
  const label = document.createElement('div');
  label.className = 'motion-edge-label';
  label.textContent = formatEdgeLabel(startMs);
  label.dataset.direction = direction;
  label.style.top = `${box.top + box.height + 6}px`;
  if (direction === 'next') label.style.left = `${box.left + box.width / 2}px`;
  else label.style.left = `${box.left + box.width / 2}px`;
  ghostLayer().appendChild(label);
  void play(
    label,
    [
      { opacity: 0, transform: 'translate(-50%, -4px)' },
      { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.12 },
      { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.85 },
      { opacity: 0, transform: 'translate(-50%, -2px)' },
    ],
    { duration: 2600 },
  ).then(() => label.remove());
}

/**
 * Shared-element morph: the ghost (old card or panel row) travels to the new
 * card while fading out, the new card travels from the ghost while fading in.
 */
function morphInto(intent: Intent, card: HTMLElement) {
  const ghost = intent.ghost;
  const from = intent.ghostBox;
  if (!ghost || !from) return;
  const to = viewportBox(card);
  intent.animating = true;
  const done = () => {
    finishGhost(intent, ghost);
    settleCard(card);
  };
  if (prefersReducedMotion() || !boxMoved(from, to, 4)) {
    void Promise.all([
      play(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS * 1.5 }),
      play(card, [{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS * 1.5, fill: 'none' }),
    ]).then(done);
    return;
  }
  const lift = 'var(--motion-lift-shadow)';
  void Promise.all([
    play(
      ghost,
      [
        { transform: 'none', opacity: 1, boxShadow: lift },
        { opacity: 0.9, offset: 0.45 },
        { transform: transformTo(from, to), opacity: 0, boxShadow: lift },
      ],
      { duration: FLIGHT_MS, easing: FLIGHT_SPRING },
    ),
    play(
      card,
      [
        { transform: travelTransform(from, to), transformOrigin: '50% 50%', opacity: 0, boxShadow: lift },
        { opacity: 0.2, offset: 0.4 },
        { transform: 'none', transformOrigin: '50% 50%', opacity: 1, boxShadow: 'none' },
      ],
      { duration: FLIGHT_MS, easing: FLIGHT_SPRING, fill: 'none' },
    ),
  ]).then(done);
}

/**
 * Drag landed: the old card's body flies onto the new one, which has been
 * filling up in place, and merges into it.
 */
function mergeInto(intent: Intent, card: HTMLElement) {
  const ghost = intent.ghost;
  const from = intent.ghostBox;
  if (!ghost || !from) return;
  const to = viewportBox(card);
  if (prefersReducedMotion() || !boxMoved(from, to, 4)) {
    fadeGhost(intent);
    return;
  }
  intent.animating = true;
  ghost.dataset.motion = 'flying';
  const mid: Box = {
    left: from.left + (to.left - from.left) * 0.5,
    top: from.top + (to.top - from.top) * 0.5 - 10,
    width: (from.width + to.width) / 2 * 1.04,
    height: (from.height + to.height) / 2 * 1.04,
  };
  void play(
    ghost,
    [
      { transform: 'none', opacity: 1, boxShadow: 'none' },
      { transform: transformTo(from, mid), opacity: 1, boxShadow: 'var(--motion-lift-shadow)', offset: 0.45 },
      { transform: transformTo(from, to), opacity: 0.9, boxShadow: 'var(--motion-lift-shadow)', offset: 0.85 },
      { transform: transformTo(from, to), opacity: 0, boxShadow: 'none' },
    ],
    { duration: FLIGHT_MS + 60, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
  ).then(() => {
    finishGhost(intent, ghost);
    settleCard(card);
  });
}

/** The card arrives from a panel section whose row is not on screen (phone sheet closed). */
function landFrom(target: HTMLElement, card: HTMLElement) {
  if (prefersReducedMotion()) {
    void play(card, [{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, fill: 'none' });
    return;
  }
  const to = viewportBox(card);
  const from = centerBox(viewportBox(target), 20);
  pulse(target);
  void play(
    card,
    [
      { transform: travelTransform(from, to, 0.3), transformOrigin: '50% 50%', opacity: 0 },
      { opacity: 1, offset: 0.35 },
      { transform: 'none', transformOrigin: '50% 50%', opacity: 1 },
    ],
    { duration: FLIGHT_MS + 80, easing: FLIGHT_SPRING, fill: 'none' },
  ).then(() => settleCard(card));
}

// ---------------------------------------------------------------- decisions

/**
 * A settled action whose ghost has nowhere to go yet: the task list or the
 * events may still be refetching. Look again a few times, then let it go.
 */
function watchGhost(intent: Intent) {
  evaluate(intent);
  if (!intent.outcome || !intent.settledAt) return;
  const since = Date.now() - Math.max(intent.settledAt, intent.heldAt ?? 0);
  clearTimeout(intent.watch);
  if (!intent.ghost || intent.animating) return;
  if (since >= SETTLE_WAIT_MS) {
    evaluate(intent, true);
    return;
  }
  intent.watch = setTimeout(() => watchGhost(intent), WATCH_MS);
}

/** Decide what a ghost does now that we may know the outcome or the new card is on screen. */
function evaluate(intent: Intent, late = false) {
  if (!intents.has(intent) || !intent.ghost || intent.animating) return;
  const card = findCard(intent, intent.ghostBox);
  if (card) {
    if (intent.ghostRole === 'emptying') {
      if (intent.outcome === 'done') mergeInto(intent, card);
      else if (intent.outcome) fadeGhost(intent);
      return;
    }
    morphInto(intent, card);
    return;
  }
  if (!intent.outcome) return;
  if (intent.outcome !== 'done') {
    if (late) fadeGhost(intent);
    return;
  }
  if (intent.kind === 'delete') {
    wipeGhost(intent);
    return;
  }
  const keys = Array.from(intent.keys);
  const dest = resolveDestination(keys);
  if (dest?.type === 'parked') {
    const target = findTarget('problems');
    if (target) flyGhostInto(intent, target);
    else fadeGhost(intent);
    return;
  }
  if (dest?.type === 'later') {
    const target = findTarget('later');
    if (target) flyGhostInto(intent, target);
    else fadeGhost(intent);
    return;
  }
  if (dest?.type === 'gone') {
    // Done, cancelled or removed elsewhere: it just leaves.
    fadeGhost(intent);
    return;
  }
  const targetMs = dest?.type === 'date' ? dest.startMs : intent.targetMs;
  const direction = targetMs != null ? offscreenDirection(targetMs, visibleRange) : null;
  if (direction && targetMs != null) {
    flyGhostToEdge(intent, direction, targetMs);
    return;
  }
  // On screen but not drawn yet: wait for the refetch, then give up quietly.
  if (late) fadeGhost(intent);
}

/** Drop of a dragged card: leave its old self at `originBox`, emptying while the server works. */
export function beginMove(
  keys: string[],
  card: HTMLElement,
  originBox: Box,
  originTime?: string,
): MotionHandle {
  const handle = trackMotion({ keys, kind: 'move' });
  const intent = findIntent(keys);
  if (intent && !intent.ghost) {
    intent.ghost = makeGhost(card, originBox);
    // The card was cloned mid-drag; the shell keeps the time it had.
    const time = intent.ghost.querySelector('.calendar-chip__time');
    if (time && originTime) time.textContent = originTime;
    intent.ghostBox = originBox;
    intent.ghostRole = 'emptying';
    intent.ghost.dataset.motion = 'emptying';
    applyStageAttrs(intent.ghost, cardMotionStage(keys) ?? 'saving');
    notify();
  }
  return handle;
}

/**
 * One layout pass of a card container. Removals first: a placeholder that
 * leaves and a real card that arrives in the same pass become one morph.
 */
export function applyPresence(change: PresenceChange) {
  // Same action, same place, new element (temp id → real id, placeholder →
  // real event): swap silently; a finished action lands with a settle.
  const removed = [...change.removed];
  const added: PresenceEntry[] = [];
  for (const entry of change.added) {
    const intent = findIntent(entry.keys);
    const twin = intent
      ? removed.findIndex(
          (gone) => findIntent(gone.keys) === intent && !boxMoved(gone.box, entry.box, 4),
        )
      : -1;
    if (twin < 0) {
      added.push(entry);
      continue;
    }
    removed.splice(twin, 1);
    if (intent?.outcome === 'done') settleCard(entry.el);
  }
  for (const entry of removed) {
    const intent = findIntent(entry.keys);
    if (!intent) {
      fadeOutCopy(entry.el, entry.box);
      continue;
    }
    if (intent.ghost && intent.ghostRole === 'emptying') {
      // The dropped card itself leaves (parked, moved again by the server),
      // even mid-merge: it is the one that travels on; the old shell fades.
      const shell = intent.ghost;
      shell.getAnimations().forEach((animation) => animation.pause());
      void play(shell, [{ opacity: Number(getComputedStyle(shell).opacity) || 1 }, { opacity: 0 }], {
        duration: FADE_MS,
      }).then(() => shell.remove());
      intent.ghost = undefined;
      intent.ghostBox = undefined;
      intent.ghostRole = undefined;
      intent.animating = false;
    }
    if (intent.ghost || intent.animating) {
      // More cards of the same action (series days): each leaves on its own.
      if (intent.kind === 'delete') wipeCopy(entry.el, entry.box);
      else fadeOutCopy(entry.el, entry.box);
      continue;
    }
    intent.ghost = makeGhost(entry.el, entry.box);
    intent.ghostBox = entry.box;
    intent.ghostRole = 'held';
    intent.heldAt = Date.now();
    intent.ghost.dataset.motion = intent.kind === 'delete' ? 'erasing' : 'busy';
    const stage = cardMotionStage(entry.keys);
    if (stage) applyStageAttrs(intent.ghost, stage);
    watchGhost(intent);
  }
  for (const entry of added) {
    const intent = findIntent(entry.keys);
    if (!intent) continue;
    if (intent.ghost && !intent.animating) {
      evaluate(intent);
      continue;
    }
    if (intent.kind === 'create') {
      enterCard(entry.el);
      continue;
    }
    if (intent.from && !intent.ghost) {
      const target = findTarget(intent.from);
      if (target) landFrom(target, entry.el);
      else enterCard(entry.el);
    }
  }
  for (const entry of change.moved) {
    const intent = findIntent(entry.keys);
    if (!intent) {
      void flipCard(entry.el, entry.from, entry.box);
      continue;
    }
    if (intent.ghostRole === 'emptying' && intent.ghost) {
      // The card went back (conflict, error): fly it home, then drop the shell.
      const keep = intent;
      void flipCard(entry.el, entry.from, entry.box, true).then(() => fadeGhost(keep));
      continue;
    }
    void flipCard(entry.el, entry.from, entry.box, true).then(() => settleCard(entry.el));
  }
}

/** Edit finished and the card stayed put (name, notes): a small pulse says «saved». */
function pulseIfStill(intent: Intent) {
  const card = findCard(intent);
  if (!card) return;
  const before = viewportBox(card);
  setTimeout(() => {
    if (intent.animating || !card.isConnected) return;
    if (boxMoved(before, viewportBox(card), 2)) return;
    settleCard(card);
  }, 450);
}

/** Tests only. */
export function resetMotionForTests() {
  for (const intent of intents) {
    clearTimeout(intent.timer);
    intent.ghost?.remove();
  }
  intents.clear();
  visibleRange = null;
  resolveDestination = () => null;
  layer?.remove();
  layer = null;
  notify();
}
