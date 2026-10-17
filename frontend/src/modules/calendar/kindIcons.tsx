import React from 'react';
import {
  Pin,
  Move,
  Repeat,
  Flame,
  Inbox,
  type LucideIcon,
} from 'lucide-react';
import type { SchedulingKind } from './schedulingKind';

export const KIND_ICONS: Record<SchedulingKind, LucideIcon> = {
  fixed: Pin,
  flexible: Move,
  recurring: Repeat,
  habit: Flame,
  unscheduled: Inbox,
};

export const KIND_I18N_KEY: Record<SchedulingKind, string> = {
  fixed: 'calendar.kind.fixed',
  flexible: 'calendar.kind.flexible',
  recurring: 'calendar.kind.recurring',
  habit: 'calendar.kind.habit',
  unscheduled: 'calendar.kind.unscheduled',
};

type KindIconProps = {
  kind: SchedulingKind;
  className?: string;
  title?: string;
};

export function KindIcon({ kind, className = 'h-3 w-3', title }: KindIconProps) {
  const Icon = KIND_ICONS[kind];
  return (
    <span title={title}>
      <Icon className={className} strokeWidth={2.25} aria-hidden />
    </span>
  );
}
