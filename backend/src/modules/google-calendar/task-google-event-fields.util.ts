export type TaskGoogleEventFields = {
  location?: string | null;
  googleColorId?: string | null;
  googleVisibility?: string | null;
  googleTransparency?: string | null;
  googleReminders?: {
    useDefault: boolean;
    overrides?: { method: 'email' | 'popup'; minutes: number }[];
  } | null;
};

export function applyTaskGoogleEventFields(
  payload: Record<string, unknown>,
  task: TaskGoogleEventFields,
  fallbackColorId?: string,
): Record<string, unknown> {
  if (task.location) {
    payload.location = task.location;
  }
  const colorId = task.googleColorId || fallbackColorId;
  if (colorId) {
    payload.colorId = colorId;
  }
  if (task.googleVisibility) {
    payload.visibility = task.googleVisibility;
  }
  if (task.googleTransparency) {
    payload.transparency = task.googleTransparency;
  }
  if (task.googleReminders) {
    payload.reminders = task.googleReminders;
  }
  return payload;
}
