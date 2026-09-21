export const GOOGLE_EVENT_COLORS = [
  { id: '1', color: '#7986cb', label: 'Lavender' },
  { id: '2', color: '#33b679', label: 'Sage' },
  { id: '3', color: '#8e24aa', label: 'Grape' },
  { id: '4', color: '#e67c73', label: 'Flamingo' },
  { id: '5', color: '#f6c026', label: 'Banana' },
  { id: '6', color: '#f5511d', label: 'Tangerine' },
  { id: '7', color: '#039be5', label: 'Peacock' },
  { id: '8', color: '#616161', label: 'Graphite' },
  { id: '9', color: '#3f51b5', label: 'Blueberry' },
  { id: '10', color: '#0b8043', label: 'Basil' },
  { id: '11', color: '#d60000', label: 'Tomato' },
] as const;

export const GOOGLE_VISIBILITY_OPTIONS = [
  { value: '', label: 'Calendar default' },
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
  { value: 'confidential', label: 'Confidential' },
] as const;

export const GOOGLE_TRANSPARENCY_OPTIONS = [
  { value: '', label: 'Busy' },
  { value: 'opaque', label: 'Busy' },
  { value: 'transparent', label: 'Free' },
] as const;

export type GoogleReminderRow = {
  method: 'popup' | 'email';
  minutes: number;
};
