import React from 'react';
import {
  GOOGLE_EVENT_COLORS,
  GOOGLE_TRANSPARENCY_OPTIONS,
  GOOGLE_VISIBILITY_OPTIONS,
  type GoogleReminderRow,
} from '../googleEventSettings';

const inp =
  'w-full rounded border border-ide-border bg-ide-input px-2.5 py-1.5 text-sm text-ide-text focus:border-ide-link focus:outline-none focus:ring-1 focus:ring-ide-link';
const lbl = 'mb-0.5 block text-xs font-medium text-ide-text';

export type GoogleEventSettingsValue = {
  location: string;
  colorId: string;
  visibility: string;
  transparency: string;
  keepDefaultReminders: boolean;
  reminders: GoogleReminderRow[];
};

type GoogleEventSettingsFieldsProps = {
  value: GoogleEventSettingsValue;
  onChange: (next: GoogleEventSettingsValue) => void;
  allowEmptyColor?: boolean;
};

export function GoogleEventSettingsFields({
  value,
  onChange,
  allowEmptyColor = false,
}: GoogleEventSettingsFieldsProps) {
  const patch = (partial: Partial<GoogleEventSettingsValue>) => onChange({ ...value, ...partial });

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="google-event-location" className={lbl}>
          Location
        </label>
        <input
          id="google-event-location"
          className={inp}
          value={value.location}
          onChange={(e) => patch({ location: e.target.value })}
        />
      </div>
      <div>
        <span className={lbl}>Color</span>
        <div className="flex flex-wrap gap-1.5">
          {allowEmptyColor ? (
            <button
              type="button"
              title="Phase color"
              aria-label="Use phase color"
              className={`h-7 w-7 rounded-full border ${
                !value.colorId
                  ? 'border-ide-link ring-2 ring-ide-link'
                  : 'border-ide-border bg-ide-surface'
              }`}
              onClick={() => patch({ colorId: '' })}
            />
          ) : null}
          {GOOGLE_EVENT_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              aria-label={c.label}
              className={`h-7 w-7 rounded-full border ${
                value.colorId === c.id
                  ? 'border-ide-link ring-2 ring-ide-link'
                  : 'border-ide-border'
              }`}
              style={{ backgroundColor: c.color }}
              onClick={() => patch({ colorId: c.id })}
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="google-event-visibility" className={lbl}>
            Visibility
          </label>
          <select
            id="google-event-visibility"
            className={inp}
            value={value.visibility}
            onChange={(e) => patch({ visibility: e.target.value })}
          >
            {GOOGLE_VISIBILITY_OPTIONS.map((opt) => (
              <option key={opt.value || 'default'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="google-event-show-as" className={lbl}>
            Show as
          </label>
          <select
            id="google-event-show-as"
            className={inp}
            value={value.transparency || 'opaque'}
            onChange={(e) => patch({ transparency: e.target.value })}
          >
            {GOOGLE_TRANSPARENCY_OPTIONS.filter((opt) => opt.value !== '').map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <span className={lbl}>Reminders</span>
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-ide-text">
          <input
            type="checkbox"
            checked={value.keepDefaultReminders}
            onChange={(e) => patch({ keepDefaultReminders: e.target.checked })}
          />
          Use calendar defaults
        </label>
        {!value.keepDefaultReminders
          ? value.reminders.map((rem, idx) => (
              <div key={idx} className="mb-2 flex flex-wrap items-center gap-2">
                <select
                  className={`${inp} w-auto min-w-[100px]`}
                  value={rem.method}
                  onChange={(e) =>
                    patch({
                      reminders: value.reminders.map((row, i) =>
                        i === idx
                          ? { ...row, method: e.target.value as GoogleReminderRow['method'] }
                          : row,
                      ),
                    })
                  }
                >
                  <option value="popup">Popup</option>
                  <option value="email">Email</option>
                </select>
                <input
                  type="number"
                  min={0}
                  className={`${inp} w-24`}
                  value={rem.minutes}
                  onChange={(e) =>
                    patch({
                      reminders: value.reminders.map((row, i) =>
                        i === idx ? { ...row, minutes: Number(e.target.value) } : row,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="text-xs text-ide-error hover:underline"
                  onClick={() =>
                    patch({ reminders: value.reminders.filter((_, i) => i !== idx) })
                  }
                >
                  Delete
                </button>
              </div>
            ))
          : null}
        {!value.keepDefaultReminders ? (
          <button
            type="button"
            className="text-xs text-ide-link hover:underline"
            onClick={() =>
              patch({
                reminders: [...value.reminders, { method: 'popup', minutes: 10 }],
              })
            }
          >
            + Reminder
          </button>
        ) : null}
      </div>
    </div>
  );
}
