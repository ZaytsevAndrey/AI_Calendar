import { useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import {
  applyPresence,
  getMotionEpoch,
  subscribeMotion,
  type PresenceEntry,
  type PresenceMove,
} from './cardMotion';
import { boxMoved, splitKeys, type Box } from './motionMath';

type Seen = PresenceEntry & {
  /** Layout box inside its scroll area, without transforms: scrolling or a running flight is not a move. */
  local: Box;
};

/** Position in the page layout from offsets: ignores transforms and every scroll position. */
function layoutOffset(el: HTMLElement): { left: number; top: number } {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = el;
  while (node) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { left, top };
}

/**
 * Layout box relative to its scroll area. Offsets ignore transforms, so a card
 * halfway through a flight still reports where it is laid out, and a second
 * move during the flight is seen at once; scrolling changes nothing.
 */
function localBox(el: HTMLElement, container: HTMLElement): Box {
  const root = el.closest<HTMLElement>('[data-motion-scroll]') ?? container;
  const own = layoutOffset(el);
  const base = layoutOffset(root);
  return { left: own.left - base.left, top: own.top - base.top, width: el.offsetWidth, height: el.offsetHeight };
}

function toBox(rect: DOMRect): Box {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function isAnimating(el: HTMLElement): boolean {
  return typeof el.getAnimations === 'function' && el.getAnimations().length > 0;
}

function collect(container: HTMLElement): Map<string, Seen> {
  const map = new Map<string, Seen>();
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('[data-motion-keys]'))) {
    const id = el.dataset.motionId;
    if (!id) continue;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
    const start = Number(el.dataset.motionStart);
    map.set(id, {
      el,
      keys: splitKeys(el.dataset.motionKeys),
      title: el.dataset.motionTitle,
      startMs: el.dataset.motionStart && Number.isFinite(start) ? start : undefined,
      box: toBox(el.getBoundingClientRect()),
      local: localBox(el, container),
    });
  }
  return map;
}

/**
 * Watch the `[data-motion-keys]` elements inside `container` after every
 * render and report which appeared, left or moved. A new `resetKey` (other
 * days, other view) starts over without animating the swap.
 */
export function useMotionPresence(
  containerRef: RefObject<HTMLElement>,
  options: { resetKey: string; skipIds?: ReadonlySet<string> },
) {
  const previous = useRef<Map<string, Seen> | null>(null);
  const lastReset = useRef(options.resetKey);
  // Re-render when an intent starts or ends so `data-motion` stays current.
  useSyncExternalStore(subscribeMotion, getMotionEpoch, () => 0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const prev = previous.current;
    const next = collect(container);
    previous.current = next;
    if (!prev || lastReset.current !== options.resetKey) {
      lastReset.current = options.resetKey;
      return;
    }
    const removed: PresenceEntry[] = [];
    const added: PresenceEntry[] = [];
    const moved: PresenceMove[] = [];
    for (const [id, seen] of prev) {
      if (!next.has(id)) removed.push(seen);
    }
    for (const [id, seen] of next) {
      const before = prev.get(id);
      if (!before) {
        added.push(seen);
        continue;
      }
      if (options.skipIds?.has(id)) continue;
      if (!boxMoved(before.local, seen.local)) continue;
      let from: Box;
      let box = seen.box;
      if (before.el === seen.el && isAnimating(seen.el)) {
        // Moved again mid-flight: start from where it is drawn right now.
        from = seen.box;
        seen.el.getAnimations().forEach((animation) => animation.cancel());
        box = toBox(seen.el.getBoundingClientRect());
        seen.box = box;
      } else {
        // Old place in today's viewport terms (the area may have scrolled since).
        const dx = seen.box.left - seen.local.left;
        const dy = seen.box.top - seen.local.top;
        from = { ...before.local, left: before.local.left + dx, top: before.local.top + dy };
      }
      moved.push({ ...seen, box, from });
    }
    if (removed.length || added.length || moved.length) applyPresence({ removed, added, moved });
  });
}
