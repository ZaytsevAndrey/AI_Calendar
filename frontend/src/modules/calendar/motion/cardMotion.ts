/**
 * Card motion: what happens to a task card while it is saved, moved, created,
 * deleted or parked, and how it travels between the grid and the «Сьогодні» panel.
 *
 * An *intent* is one user action on a set of keys (event id, task id). It lives
 * from the action until its animation ends. Cards and panel rows carry
 * `data-motion-keys`; `useMotionPresence` reports what appeared, left or moved,
 * and this module decides how to animate it with the Web Animations API.
 * Ghosts are DOM clones in one fixed layer above the page, so a card can fly
 * from a panel row or a sheet into the grid. Every flight follows an arc.
 *
 * Placing a task (create, «На потім», a problem) with a known slot puts a
 * placeholder card on the grid at once (`pendingPlacements`); the row flies
 * into it, and the real event takes its place whenever Google returns it.
 */
import type { MutationStage } from '../../schedule/taskMutationProgress';
import {
  arcTransforms,
  boxMoved,
  offscreenDirection,
  splitKeys,
  springEasing,
  stageProgress,
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

/** A placeholder card the calendar draws for a task being placed. */
export type PendingPlacement = {
  id: string;
  keys: string[];
  title: string;
  startMs?: number;
  durationMs?: number;
};

type GhostRole = 'emptying' | 'held';

type Intent = {
  id: number;
  kind: MotionKind;
  keys: Set<string>;
  from?: MotionFrom;
  title?: string;
  targetMs?: number;
  durationMs?: number;
  outcome?: MotionOutcome;
  createdAt: number;
  settledAt?: number;
  ghost?: HTMLElement;
  ghostBox?: Box;
  ghostRole?: GhostRole;
  animating: boolean;
  /** Create / place: a placeholder stands until a real card for it shows up. */
  awaitingCard: boolean;
  /** The source row already flew into the placeholder; its own exit is quiet. */
  flown: boolean;
  /** The flight into the placeholder waits for a sheet to close. */
  waitingDialog?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  watch?: ReturnType<typeof setTimeout>;
  stale?: ReturnType<typeof setTimeout>;
  /** When the current ghost started waiting for its destination. */
  heldAt?: number;
};

export type MotionHandle = {
  addKey: (key: string | null | undefined) => void;
  settle: (outcome: MotionOutcome, details?: { targetMs?: number }) => void;
};

export type PresenceEntry = {
  el: HTMLElement;
  keys: string[];
  box: Box;
  title?: string;
  startMs?: number;
};
export type PresenceMove = PresenceEntry & { from: Box };

export type PresenceChange = {
  removed: PresenceEntry[];
  added: PresenceEntry[];
  moved: PresenceMove[];
};

const PLACEHOLDER_PREFIX = 'local-motion:';
/** A settled intent waits this long for its card before letting the ghost go. */
const SETTLE_WAIT_MS = 2500;
const WATCH_MS = 250;
/** After the animation, keep the intent briefly so a late refetch still animates as this action. */
const LINGER_MS = 4000;
/** A placeholder waits this long for Google to return the real event. */
const PLACEHOLDER_MAX_MS = 90_000;
/** No server answer this long: drop the ghost rather than leave it on screen. */
const STALE_MS = 30_000;

const FLIGHT_MS = 640;
const FLIP_MS = 420;
const ENTER_MS = 900;
const WIPE_MS = 560;
const FADE_MS = 180;

const SPRING = springEasing(0.2);
const SOFT_SPRING = springEasing(0.08);
/** Flights between places: a visible glide, a small overshoot on landing. */
const FLIGHT_SPRING = springEasing(0.12, 1.05);
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.45, 0, 0.2, 1)';

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

function hasDom(): boolean {
  return typeof document !== 'undefined';
}

function canAnimate(el: Element): el is HTMLElement {
  return typeof (el as HTMLElement).animate === 'function';
}

function sameTitle(a?: string, b?: string): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
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
 * The intent a card on screen belongs to. By keys first; a new card whose ids
 * we could not link yet (Google returned the event before the task knows its
 * id, a series day) matches a placing action by title and slot.
 */
function intentForEntry(entry: Pick<PresenceEntry, 'keys' | 'title' | 'startMs'>): Intent | undefined {
  const byKeys = findIntent(entry.keys);
  if (byKeys) return byKeys;
  if (!entry.title) return undefined;
  let found: Intent | undefined;
  for (const intent of intents) {
    const placing = intent.awaitingCard || intent.ghostRole === 'held';
    if (!placing || !sameTitle(intent.title, entry.title)) continue;
    if (intent.targetMs != null && entry.startMs != null) {
      // Same name elsewhere in the week is another task; the server may shift the slot a little.
      if (Math.abs(entry.startMs - intent.targetMs) > 6 * 3600_000) continue;
    }
    if (!found || intent.id > found.id) found = intent;
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
  title?: string;
  targetMs?: number;
  durationMs?: number;
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
          title: options.title,
          targetMs: options.targetMs,
          durationMs: options.durationMs,
          createdAt: Date.now(),
          animating: false,
          awaitingCard: options.kind === 'create' || options.kind === 'place',
          flown: false,
        };
  if (intent !== existing) {
    intents.add(intent);
    scheduleStale(intent);
    notify();
  } else {
    intent.targetMs ??= options.targetMs;
    intent.durationMs ??= options.durationMs;
    intent.title ??= options.title;
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
  clearTimeout(intent.stale);
  if (details?.targetMs != null) intent.targetMs = details.targetMs;
  // A failed placement takes its placeholder away (it flies back to the row).
  if (outcome !== 'done') intent.awaitingCard = false;
  notify();
  if (outcome === 'done' && !intent.ghost && intent.kind === 'edit') pulseIfStill(intent);
  watchGhost(intent);
  scheduleCleanup(intent);
}

function scheduleStale(intent: Intent) {
  intent.stale = setTimeout(() => {
    if (!intents.has(intent) || intent.outcome) return;
    settleIntent(intent, 'cancel');
  }, STALE_MS);
}

function scheduleCleanup(intent: Intent) {
  clearTimeout(intent.timer);
  intent.timer = setTimeout(() => {
    const waitingForGoogle =
      intent.awaitingCard && Date.now() - intent.createdAt < PLACEHOLDER_MAX_MS;
    if (intent.animating || intent.ghost || waitingForGoogle) {
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
  // A placeholder keeps filling until the real event replaces it.
  if (keys.some((key) => key.startsWith(PLACEHOLDER_PREFIX))) return 'forming';
  if (intent.outcome) return null;
  if (intent.kind === 'move' && intent.ghost) return 'forming';
  if (intent.kind === 'create') return 'forming';
  return 'busy';
}

/** Stage of the action on these keys, for the progress fill. */
export function cardMotionStage(keys: string[]): MutationStage | null {
  const intent = findIntent(keys);
  if (!intent) return null;
  if (intent.outcome === 'done' && intent.awaitingCard) return 'syncing';
  if (intent.outcome) return null;
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
  return !intent.outcome || intent.animating || keys.some((key) => key.startsWith(PLACEHOLDER_PREFIX));
}

/** Placeholder cards for tasks being placed, newest action per task. */
export function pendingPlacements(): PendingPlacement[] {
  const out: PendingPlacement[] = [];
  for (const intent of intents) {
    if (!intent.awaitingCard) continue;
    out.push({
      id: `${PLACEHOLDER_PREFIX}${intent.id}`,
      keys: [`${PLACEHOLDER_PREFIX}${intent.id}`, ...intent.keys],
      title: intent.title ?? '',
      startMs: intent.targetMs,
      durationMs: intent.durationMs,
    });
  }
  return out;
}

/** Placements the server finished whose Google event has not shown up yet. */
export function placementsWaitingForGoogle(): number {
  let count = 0;
  for (const intent of intents) {
    if (intent.awaitingCard && intent.outcome === 'done') count += 1;
  }
  return count;
}

/** Keys of a placeholder card, by its event id. */
export function placeholderKeys(eventId: string): string[] | null {
  if (!eventId.startsWith(PLACEHOLDER_PREFIX)) return null;
  const id = Number(eventId.slice(PLACEHOLDER_PREFIX.length));
  for (const intent of intents) {
    if (intent.id === id) return [eventId, ...intent.keys];
  }
  return [eventId];
}

export function isPlaceholderId(eventId: string): boolean {
  return eventId.startsWith(PLACEHOLDER_PREFIX);
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
  el.removeAttribute('data-motion-id');
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

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1440 : window.innerWidth;
}

function entryOf(el: HTMLElement): Pick<PresenceEntry, 'keys' | 'title' | 'startMs'> {
  const start = Number(el.dataset.motionStart);
  return {
    keys: splitKeys(el.dataset.motionKeys),
    title: el.dataset.motionTitle,
    startMs: el.dataset.motionStart && Number.isFinite(start) ? start : undefined,
  };
}

/** Cards and rows on screen that belong to this intent (not ghosts). */
function matchingElements(intent: Intent): HTMLElement[] {
  if (!hasDom()) return [];
  return Array.from(document.querySelectorAll<HTMLElement>('[data-motion-keys]')).filter(
    (el) => isShown(el) && intentForEntry(entryOf(el)) === intent,
  );
}

/** The card a ghost lands on: the one at the target slot, else the nearest copy. */
function findCard(intent: Intent, near?: Box): HTMLElement | null {
  // Only calendar cards; a panel row is a source, not a landing place.
  const cards = matchingElements(intent).filter((el) => el.dataset.motionStart != null);
  if (cards.length <= 1) return cards[0] ?? null;
  if (intent.targetMs != null) {
    const atSlot = cards.find(
      (el) => Math.abs(Number(el.dataset.motionStart) - (intent.targetMs as number)) < 60_000,
    );
    if (atSlot) return atSlot;
  }
  if (!near) return cards[0];
  let best = cards[0];
  let bestDist = Infinity;
  for (const el of cards) {
    const box = viewportBox(el);
    const dist = Math.hypot(box.left - near.left, box.top - near.top);
    if (dist < bestDist) {
      best = el;
      bestDist = dist;
    }
  }
  return best;
}

/** The panel row or problem card this action started from, if it is on screen. */
function findSource(intent: Intent, except: HTMLElement): HTMLElement | null {
  return (
    matchingElements(intent).find((el) => el !== except && el.dataset.motionStart == null) ?? null
  );
}

function findTarget(name: MotionTarget): HTMLElement | null {
  if (!hasDom()) return null;
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
  if (!hasDom()) return null;
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

/** Keyframes along an arc; `extra(t)` adds opacity, shadow and the like per sample. */
function arcFrames(
  start: Box,
  end: Box,
  base: Box,
  extra?: (t: number) => Keyframe,
  options?: { bow?: number; lift?: number; minScale?: number; maxScale?: number },
): Keyframe[] {
  const transforms = arcTransforms({
    start,
    end,
    base,
    viewportWidth: viewportWidth(),
    ...options,
  });
  return transforms.map((transform, i) => {
    const t = i / (transforms.length - 1);
    return { transform, transformOrigin: '50% 50%', offset: t, ...(extra?.(t) ?? {}) };
  });
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

function chipColor(el: HTMLElement): string {
  const own = el.style.getPropertyValue('--chip-color');
  if (own) return own;
  if (typeof getComputedStyle !== 'function') return 'rgb(var(--ide-muted))';
  return getComputedStyle(el).getPropertyValue('--chip-color').trim() || 'rgb(var(--ide-muted))';
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

/**
 * A new card: a bright line spreads across the start time, the card unfolds
 * down from it with a little overshoot, its text slides in, and a soft ring
 * in the phase color says «here».
 */
function enterCard(el: HTMLElement) {
  if (prefersReducedMotion()) {
    void play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, fill: 'none' });
    return;
  }
  const color = chipColor(el);
  void play(
    el,
    [
      // The line spreads from the middle…
      { clipPath: 'inset(0 50% calc(100% - 3px) 50% round 6px)', offset: 0, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
      // …holds for a beat…
      { clipPath: 'inset(0 0 calc(100% - 3px) 0 round 6px)', offset: 0.26 },
      { clipPath: 'inset(0 0 calc(100% - 3px) 0 round 6px)', offset: 0.32, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
      // …then the card unfolds down, a touch past its end, and settles.
      { clipPath: 'inset(0 0 -4px 0 round 6px)', offset: 0.86, easing: 'ease-out' },
      { clipPath: 'inset(0 0 0 0 round 6px)', offset: 1 },
    ],
    { duration: ENTER_MS, easing: 'linear', fill: 'none' },
  );
  void play(
    el,
    [
      { boxShadow: '0 0 0 0 transparent', offset: 0 },
      { boxShadow: `0 0 0 0 ${color}`, offset: 0.6 },
      { boxShadow: '0 0 0 9px transparent', offset: 1 },
    ],
    { duration: ENTER_MS + 300, easing: 'ease-out', fill: 'none' },
  );
  revealText(el, 0.5);
}

/** Title, then the time line, slide up into the card. */
function revealText(el: HTMLElement, startAt: number) {
  const parts = el.querySelectorAll<HTMLElement>('.calendar-chip__title, .calendar-chip__sub');
  parts.forEach((part, index) => {
    void play(
      part,
      [
        { opacity: 0, transform: 'translateY(5px)' },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: 280,
        delay: ENTER_MS * startAt + index * 70,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'backwards',
      },
    );
  });
}

/**
 * Layout change (another card's move pushed this one, a resize, a form edit):
 * travel from the old place along a shallow arc. Only the position travels; a
 * new size fades in.
 */
function flipCard(el: HTMLElement, from: Box, to: Box, lifted = false): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  el.getAnimations?.().forEach((animation) => animation.cancel());
  const resized = Math.abs(from.width - to.width) > 4 || Math.abs(from.height - to.height) > 4;
  // Travel the position only: the start box keeps the new size, so text never stretches.
  const start: Box = { ...to, left: from.left + (from.width - to.width) / 2, top: from.top };
  const distance = Math.hypot(start.left - to.left, start.top - to.top);
  const frames = arcFrames(
    start,
    to,
    to,
    (t) => ({
      opacity: resized ? 0.55 + 0.45 * t : 1,
      ...(lifted ? { boxShadow: t < 0.85 ? 'var(--motion-lift-shadow)' : 'none' } : {}),
    }),
    { bow: distance < 60 ? 0 : lifted ? 0.3 : 0.14, lift: lifted ? 0.05 : 0, minScale: 1, maxScale: 1 },
  );
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
  }).then(() => finishGhost(intent, ghost));
}

function fadeOutCopy(el: HTMLElement, box: Box) {
  const ghost = makeGhost(el, box);
  void play(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS }).then(() =>
    ghost.remove(),
  );
}

/**
 * «Стирається»: the card tightens for a beat, then an eraser sweeps it away
 * from the left; crumbs in the phase color fall off the eraser's edge.
 */
function eraseElement(ghost: HTMLElement, box: Box): Promise<void> {
  if (prefersReducedMotion() || !canAnimate(ghost)) {
    return play(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS });
  }
  ghost.dataset.motion = 'erasing';
  const color = chipColor(ghost);
  const press = 90;
  const sweep = WIPE_MS - press;
  const tilt = 'scale(0.97) rotate(-0.6deg)';
  const wipe = play(
    ghost,
    [
      { clipPath: 'inset(0 0 0 0 round 6px)', transform: 'none', offset: 0 },
      { clipPath: 'inset(0 0 0 0 round 6px)', transform: tilt, offset: press / WIPE_MS },
      { clipPath: 'inset(0 0 0 100% round 6px)', transform: tilt, offset: 1 },
    ],
    { duration: WIPE_MS, easing: 'linear' },
  );
  const host = ghostLayer();
  const eraser = document.createElement('div');
  eraser.className = 'motion-eraser';
  Object.assign(eraser.style, {
    left: `${box.left - 8}px`,
    top: `${box.top - 2}px`,
    height: `${box.height + 4}px`,
  });
  host.appendChild(eraser);
  void play(
    eraser,
    [
      { transform: 'translateX(0)', opacity: 0 },
      { transform: 'translateX(0)', opacity: 1, offset: press / WIPE_MS },
      { transform: `translateX(${box.width}px)`, opacity: 1, offset: 0.92 },
      { transform: `translateX(${box.width + 6}px)`, opacity: 0 },
    ],
    { duration: WIPE_MS, easing: 'linear' },
  ).then(() => eraser.remove());
  const crumbs = Math.max(8, Math.min(22, Math.round((box.width * box.height) / 600)));
  for (let i = 0; i < crumbs; i += 1) {
    const crumb = document.createElement('div');
    crumb.className = 'motion-crumb';
    const along = (i + Math.random() * 0.6) / crumbs;
    const size = 3 + Math.random() * 3;
    Object.assign(crumb.style, {
      left: `${box.left + box.width * along}px`,
      top: `${box.top + Math.random() * box.height}px`,
      width: `${size}px`,
      height: `${size}px`,
      background: i % 3 === 0 ? 'rgb(var(--ide-muted))' : color,
    });
    host.appendChild(crumb);
    const dx = 6 + Math.random() * 22;
    const dy = 18 + Math.random() * 34;
    void play(
      crumb,
      [
        { transform: 'translate(0, 0) rotate(0deg)', opacity: 0 },
        { opacity: 0.9, offset: 0.12 },
        { transform: `translate(${dx * 0.6}px, ${-4 - Math.random() * 6}px) rotate(40deg)`, offset: 0.35 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${90 + Math.random() * 120}deg)`, opacity: 0 },
      ],
      { duration: 520, delay: press + sweep * along, easing: 'cubic-bezier(0.3, 0, 0.7, 1)', fill: 'backwards' },
    ).then(() => crumb.remove());
  }
  return wipe;
}

function wipeGhost(intent: Intent) {
  const ghost = intent.ghost;
  const box = intent.ghostBox;
  if (!ghost || !box) return;
  intent.animating = true;
  void eraseElement(ghost, box).then(() => finishGhost(intent, ghost));
}

function wipeCopy(el: HTMLElement, box: Box) {
  const ghost = makeGhost(el, box);
  void eraseElement(ghost, box).then(() => ghost.remove());
}

/** A ghost flies along an arc into a button or counter, which pulses. */
function flyInto(ghost: HTMLElement, from: Box, target: HTMLElement, after?: () => void): Promise<void> {
  if (prefersReducedMotion()) {
    return play(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS }).then(() => {
      ghost.remove();
      after?.();
    });
  }
  const to = centerBox(viewportBox(target), 18);
  return play(
    ghost,
    arcFrames(
      from,
      to,
      from,
      (t) => ({
        opacity: t < 0.7 ? 1 : 1 - ((t - 0.7) / 0.3) * 0.85,
        boxShadow: t > 0.1 && t < 0.8 ? 'var(--motion-lift-shadow)' : 'none',
      }),
      { bow: 0.35, lift: 0.08 },
    ),
    { duration: FLIGHT_MS + 100, easing: 'cubic-bezier(0.5, 0, 0.3, 1)' },
  ).then(() => {
    ghost.remove();
    pulse(target);
    after?.();
  });
}

function flyGhostInto(intent: Intent, target: HTMLElement) {
  const ghost = intent.ghost;
  const from = intent.ghostBox;
  if (!ghost || !from) return;
  intent.animating = true;
  void flyInto(ghost, from, target).then(() => finishGhost(intent, ghost));
}

/** Off the visible days: fly to the pagination arrow and say which day it went to. */
function flyToEdge(ghost: HTMLElement, from: Box, direction: EdgeDirection, startMs: number): Promise<void> {
  const edge = findEdge(direction);
  if (edge) return flyInto(ghost, from, edge, () => showEdgeLabel(edge, direction, startMs));
  if (prefersReducedMotion()) {
    return play(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS }).then(() => ghost.remove());
  }
  const dx = direction === 'next' ? viewportWidth() : -viewportWidth();
  return play(
    ghost,
    [
      { transform: 'none', opacity: 1 },
      { transform: `translate(${dx * 0.3}px, -40px) scale(0.95)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx * 0.6}px, 0) scale(0.9)`, opacity: 0 },
    ],
    { duration: FLIGHT_MS, easing: EASE_IN },
  ).then(() => ghost.remove());
}

/** One label per arrow: several cards sent the same way update it instead of stacking. */
const edgeLabels = new Map<
  EdgeDirection,
  { el: HTMLElement; count: number; timer?: ReturnType<typeof setTimeout> }
>();

function showEdgeLabel(edge: HTMLElement, direction: EdgeDirection, startMs: number) {
  const box = viewportBox(edge);
  const existing = edgeLabels.get(direction);
  const label = existing?.el ?? document.createElement('div');
  const count = (existing?.count ?? 0) + 1;
  label.className = 'motion-edge-label';
  label.dataset.direction = direction;
  label.textContent =
    count > 1 ? `${formatEdgeLabel(startMs)} · +${count - 1}` : formatEdgeLabel(startMs);
  label.style.top = `${box.top + box.height + 6}px`;
  label.style.left = `${box.left + box.width / 2}px`;
  if (!existing) {
    ghostLayer().appendChild(label);
    void play(
      label,
      [
        { opacity: 0, transform: 'translate(-50%, -4px)' },
        { opacity: 1, transform: 'translate(-50%, 0)' },
      ],
      { duration: 220, fill: 'forwards' },
    );
  }
  clearTimeout(existing?.timer);
  const timer = setTimeout(() => {
    edgeLabels.delete(direction);
    void play(
      label,
      [
        { opacity: 1, transform: 'translate(-50%, 0)' },
        { opacity: 0, transform: 'translate(-50%, -2px)' },
      ],
      { duration: 260 },
    ).then(() => label.remove());
  }, 2600);
  edgeLabels.set(direction, { el: label, count, timer });
}

/**
 * Shared-element morph along an arc: the ghost (old card or panel row) travels
 * to the new card while fading out, the new card travels from the ghost while
 * fading in.
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
  void Promise.all([
    play(
      ghost,
      arcFrames(from, to, from, (t) => ({
        opacity: t < 0.45 ? 1 : 1 - (t - 0.45) / 0.55,
        boxShadow: 'var(--motion-lift-shadow)',
      })),
      { duration: FLIGHT_MS, easing: FLIGHT_SPRING },
    ),
    play(
      card,
      arcFrames(
        from,
        to,
        to,
        (t) => ({
          opacity: t < 0.35 ? 0 : Math.min(1, (t - 0.35) / 0.45),
          boxShadow: t < 0.9 ? 'var(--motion-lift-shadow)' : 'none',
        }),
        { minScale: 0.4, maxScale: 1.2 },
      ),
      { duration: FLIGHT_MS, easing: FLIGHT_SPRING, fill: 'none' },
    ),
  ]).then(done);
}

/**
 * Drag landed: the old card's body flies over onto the new one, which has
 * been filling up in place, and merges into it.
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
  void play(
    ghost,
    arcFrames(
      from,
      to,
      from,
      (t) => ({
        opacity: t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15,
        boxShadow: t > 0.05 && t < 0.9 ? 'var(--motion-lift-shadow)' : 'none',
      }),
      { lift: 0.06 },
    ),
    { duration: FLIGHT_MS + 60, easing: EASE_IN_OUT },
  ).then(() => {
    finishGhost(intent, ghost);
    settleCard(card);
  });
}

/** The card arrives from a panel section whose row is not on screen (phone sheet closed). */
function landFrom(from: Box, card: HTMLElement, pulseTarget?: HTMLElement) {
  if (prefersReducedMotion()) {
    void play(card, [{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, fill: 'none' });
    return;
  }
  const to = viewportBox(card);
  if (pulseTarget) pulse(pulseTarget);
  void play(
    card,
    arcFrames(from, to, to, (t) => ({ opacity: Math.min(1, t / 0.35) }), {
      minScale: 0.3,
      maxScale: 1.2,
      bow: 0.32,
    }),
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

/** Where a card that left the screen went: off the visible days, parked, Later — or null. */
function sendAway(ghost: HTMLElement, from: Box, keys: string[], fallbackMs?: number): Promise<void> | null {
  const dest = resolveDestination(keys);
  if (dest?.type === 'parked' || dest?.type === 'later') {
    const target = findTarget(dest.type === 'parked' ? 'problems' : 'later');
    return target ? flyInto(ghost, from, target) : null;
  }
  const targetMs = dest?.type === 'date' ? dest.startMs : fallbackMs;
  const direction = targetMs != null ? offscreenDirection(targetMs, visibleRange) : null;
  if (direction && targetMs != null) return flyToEdge(ghost, from, direction, targetMs);
  return null;
}

/** Decide what a ghost does now that we may know the outcome or the new card is on screen. */
function evaluate(intent: Intent, late = false) {
  if (!intents.has(intent) || !intent.ghost || intent.animating) return;
  const card = findCard(intent, intent.ghostBox);
  if (card && coveredByDialog(null)) {
    // A sheet still covers the grid: fly once it closes.
    setTimeout(() => evaluate(intent, late), 150);
    return;
  }
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
  const dest = resolveDestination(Array.from(intent.keys));
  if (dest?.type === 'gone') {
    // Done, cancelled or removed elsewhere: it just leaves.
    fadeGhost(intent);
    return;
  }
  if (dest?.type === 'parked' || dest?.type === 'later') {
    const target = findTarget(dest.type === 'parked' ? 'problems' : 'later');
    if (target) flyGhostInto(intent, target);
    else fadeGhost(intent);
    return;
  }
  const ghost = intent.ghost;
  const from = intent.ghostBox;
  if (!from) return;
  const targetMs = dest?.type === 'date' ? dest.startMs : intent.targetMs;
  const direction = targetMs != null ? offscreenDirection(targetMs, visibleRange) : null;
  if (direction && targetMs != null) {
    intent.animating = true;
    void flyToEdge(ghost, from, direction, targetMs).then(() => finishGhost(intent, ghost));
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

function isPlaceholderEntry(entry: Pick<PresenceEntry, 'keys'>): boolean {
  return entry.keys.some((key) => key.startsWith(PLACEHOLDER_PREFIX));
}

/** An open dialog covers the page and does not contain `el`: a flight under it would be invisible. */
function coveredByDialog(el?: HTMLElement | null): boolean {
  if (!hasDom()) return false;
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).some(
    (dialog) => isShown(dialog) && !(el && dialog.contains(el)),
  );
}

/**
 * Run `fly` once no dialog hides it (the slot sheet closes after the server
 * answers). Until then the card waits invisible so it cannot pop in early.
 */
function whenUncovered(card: HTMLElement, source: HTMLElement | null, fly: () => void) {
  if (!coveredByDialog(source)) {
    fly();
    return;
  }
  card.style.opacity = '0';
  const started = Date.now();
  const tick = () => {
    if (!card.isConnected) return;
    if (coveredByDialog(source) && Date.now() - started < 20_000) {
      setTimeout(tick, 120);
      return;
    }
    // Let the dialog's exit animation clear first.
    setTimeout(() => {
      card.style.opacity = '';
      if (card.isConnected) fly();
    }, 160);
  };
  setTimeout(tick, 120);
}

/** A placeholder just showed up: its row flies into it, or it lands from the panel counter. */
function arrivePlaceholder(intent: Intent, entry: PresenceEntry) {
  const source = intent.ghost ? null : findSource(intent, entry.el);
  intent.flown = true;
  intent.waitingDialog = coveredByDialog(null);
  if (intent.waitingDialog && source && !intent.ghost) {
    // The row sits in a sheet that may close with it: keep a hidden snapshot to fly from.
    const box = viewportBox(source);
    intent.ghost = makeGhost(source, box);
    intent.ghost.style.opacity = '0';
    intent.ghostBox = box;
    intent.ghostRole = 'held';
  }
  whenUncovered(entry.el, null, () => {
    intent.waitingDialog = false;
    if (intent.ghost) intent.ghost.style.opacity = '';
    flyToPlaceholder(intent, entry);
  });
}

function flyToPlaceholder(intent: Intent, entry: PresenceEntry) {
  if (intent.animating) return;
  if (intent.ghost && !intent.animating) {
    morphInto(intent, entry.el);
    return;
  }
  // The row stays (busy) until the server answers; a copy of it does the flying.
  // Looked up again: the sheet over it may have just closed.
  const source = intent.ghost ? null : findSource(intent, entry.el);
  if (source) {
    const box = viewportBox(source);
    intent.ghost = makeGhost(source, box);
    intent.ghostBox = box;
    intent.ghostRole = 'held';
    morphInto(intent, entry.el);
    return;
  }
  const target = intent.from ? findTarget(intent.from) : null;
  if (target) {
    landFrom(centerBox(viewportBox(target), 20), entry.el, target);
    return;
  }
  enterCard(entry.el);
}

/**
 * One layout pass of a card container. Removals first: a placeholder that
 * leaves and a real card that arrives in the same pass become one move.
 */
export function applyPresence(change: PresenceChange) {
  const removed = [...change.removed];
  const added: PresenceEntry[] = [];

  // Same action, same place, new element (placeholder → real event, temp id → real id):
  // swap silently; a finished action lands with a settle.
  for (const entry of change.added) {
    const intent = intentForEntry(entry);
    const twin = intent
      ? removed.findIndex(
          (gone) => intentForEntry(gone) === intent && !boxMoved(gone.box, entry.box, 4),
        )
      : -1;
    if (twin < 0) {
      added.push(entry);
      continue;
    }
    removed.splice(twin, 1);
    if (intent && !isPlaceholderEntry(entry) && entry.startMs != null) intent.awaitingCard = false;
    if (intent?.outcome === 'done') settleCard(entry.el);
  }

  // An event that came back under a new id (series regenerated, re-created in
  // Google) with no action behind it: one card moving, not one gone + one new.
  for (let i = added.length - 1; i >= 0; i -= 1) {
    const entry = added[i];
    if (entry.startMs == null || !entry.title || intentForEntry(entry)) continue;
    const twin = removed.findIndex(
      (gone) => gone.startMs != null && sameTitle(gone.title, entry.title) && !intentForEntry(gone),
    );
    if (twin < 0) continue;
    const [gone] = removed.splice(twin, 1);
    added.splice(i, 1);
    void flipCard(entry.el, gone.box, entry.box);
  }

  for (const entry of removed) {
    const intent = intentForEntry(entry);
    if (!intent) {
      // Moved by someone else's action (a replan, another device): follow it if we can.
      const ghost = makeGhost(entry.el, entry.box);
      const away = entry.startMs != null ? sendAway(ghost, entry.box, entry.keys) : null;
      if (!away) {
        void play(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS }).then(() =>
          ghost.remove(),
        );
      }
      continue;
    }
    if (intent.flown && entry.startMs == null) {
      if (intent.waitingDialog && !intent.ghost) {
        // Left the list while the sheet is still open: its snapshot does the flying later.
        intent.ghost = makeGhost(entry.el, entry.box);
        intent.ghostBox = entry.box;
        intent.ghostRole = 'held';
        continue;
      }
      // The row already flew into its placeholder.
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
    const intent = intentForEntry(entry);
    if (!intent) continue;
    if (isPlaceholderEntry(entry)) {
      arrivePlaceholder(intent, entry);
      continue;
    }
    if (entry.startMs != null) intent.awaitingCard = false;
    if (intent.ghost && !intent.animating) {
      evaluate(intent);
      continue;
    }
    if (intent.kind === 'create') {
      enterCard(entry.el);
      continue;
    }
    if (intent.from && !intent.flown && entry.startMs != null) {
      intent.flown = true;
      const from = intent.from;
      whenUncovered(entry.el, null, () => {
        const target = findTarget(from);
        if (target) landFrom(centerBox(viewportBox(target), 20), entry.el, target);
        else enterCard(entry.el);
      });
    }
  }

  for (const entry of change.moved) {
    const intent = intentForEntry(entry);
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
    clearTimeout(intent.watch);
    clearTimeout(intent.stale);
    intent.ghost?.remove();
  }
  intents.clear();
  edgeLabels.clear();
  visibleRange = null;
  resolveDestination = () => null;
  layer?.remove();
  layer = null;
  notify();
}
