import { useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import {
  applyPresence,
  getMotionEpoch,
  subscribeMotion,
  type PresenceEntry,
  type PresenceMove,
} from './cardMotion';
import { boxMoved, splitKeys, type Box } from './motionMath';

type Seen = {
  el: HTMLElement;
  keys: string[];
  /** Viewport box: where a ghost of this element is drawn if it leaves. */
  box: Box;
  /** Box inside its scroll area: scrolling is not a move. */
  local: Box;
};

function localBox(el: HTMLElement, rect: DOMRect, container: HTMLElement): Box {
  const root = el.closest<HTMLElement>('[data-motion-scroll]') ?? container;
  const base = root.getBoundingClientRect();
  return {
    left: rect.left - base.left + root.scrollLeft,
    top: rect.top - base.top + root.scrollTop,
    width: rect.width,
    height: rect.height,
  };
}

function isAnimating(el: HTMLElement): boolean {
  return typeof el.getAnimations === 'function' && el.getAnimations().length > 0;
}

function collect(container: HTMLElement, prev: Map<string, Seen> | null): Map<string, Seen> {
  const map = new Map<string, Seen>();
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('[data-motion-keys]'))) {
    const id = el.dataset.motionId;
    if (!id) continue;
    const before = prev?.get(id);
    // Mid-flight boxes include the transform; keep the last resting box instead.
    if (before && before.el === el && isAnimating(el)) {
      map.set(id, { ...before, keys: splitKeys(el.dataset.motionKeys) });
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    map.set(id, {
      el,
      keys: splitKeys(el.dataset.motionKeys),
      box: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      local: localBox(el, rect, container),
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
    const next = collect(container, prev);
    previous.current = next;
    if (!prev || lastReset.current !== options.resetKey) {
      lastReset.current = options.resetKey;
      return;
    }
    const removed: PresenceEntry[] = [];
    const added: PresenceEntry[] = [];
    const moved: PresenceMove[] = [];
    for (const [id, seen] of prev) {
      if (!next.has(id)) removed.push({ el: seen.el, keys: seen.keys, box: seen.box });
    }
    for (const [id, seen] of next) {
      const before = prev.get(id);
      if (!before) {
        added.push({ el: seen.el, keys: seen.keys, box: seen.box });
        continue;
      }
      if (options.skipIds?.has(id)) continue;
      if (boxMoved(before.local, seen.local)) {
        const dx = seen.box.left - seen.local.left;
        const dy = seen.box.top - seen.local.top;
        // Old place in today's viewport terms (the area may have scrolled since).
        const from: Box = { ...before.local, left: before.local.left + dx, top: before.local.top + dy };
        moved.push({ el: seen.el, keys: seen.keys, box: seen.box, from });
      }
    }
    if (removed.length || added.length || moved.length) applyPresence({ removed, added, moved });
  });
}
