import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, MapPin } from 'lucide-react';
import { useSearchPlacesQuery, type PlaceSuggestionDTO } from 'api/places.api';
import { Input } from 'ui/Input';
import { Spinner } from 'ui/Spinner';

const MIN_QUERY = 3;
const DEBOUNCE_MS = 300;

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Free-text location with OpenStreetMap suggestions. Typing anything is valid;
 * a suggestion only fills the line. Arrow keys move, Enter picks, Escape closes.
 */
export function LocationField({ id, value, onChange, placeholder }: Props) {
  const { t, i18n } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [typed, setTyped] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const query = useDebounced(value.trim(), DEBOUNCE_MS);
  const search = typed && query.length >= MIN_QUERY;
  const { data: places = [], isFetching } = useSearchPlacesQuery(
    { q: query, lang: i18n.language },
    { skip: !search },
  );
  const showPanel = open && search && (places.length > 0 || isFetching);

  useLayoutEffect(() => {
    if (!showPanel) return;
    const place = () => {
      const box = wrapRef.current?.getBoundingClientRect();
      if (!box) return;
      const height = panelRef.current?.offsetHeight ?? 240;
      const below = box.bottom + 4;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, box.top - height - 4) : below;
      setRect({ top, left: box.left, width: box.width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [showPanel, places.length]);

  useEffect(() => setActive(-1), [places]);

  const pick = (place: PlaceSuggestionDTO) => {
    onChange(place.label);
    setTyped(false);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showPanel || !places.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % places.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? places.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      // Enter picks the place instead of submitting the form.
      e.preventDefault();
      pick(places[active]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const mapUrl = value.trim()
    ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(value.trim())}`
    : null;

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={id}
        autoComplete="off"
        leadingIcon={MapPin}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={placeholder ?? t('places.placeholder')}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {mapUrl ? (
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 inline-flex items-center gap-1 text-xs text-ide-link hover:underline"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          {t('places.openMap')}
        </a>
      ) : null}
      {showPanel && rect && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[1500] overflow-hidden rounded-lg border border-ide-border bg-ide-panel shadow-ide-md"
              style={{ top: rect.top, left: rect.left, width: rect.width }}
            >
              <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
                {places.map((place, index) => (
                  <li
                    key={`${place.label}-${place.lat}-${place.lon}`}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    className={`flex cursor-pointer items-start gap-2 px-3 py-1.5 text-xs ${
                      index === active ? 'bg-ide-selection' : 'hover:bg-ide-elevated'
                    }`}
                    // mousedown keeps focus in the input so blur does not close first.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(place);
                    }}
                    onMouseEnter={() => setActive(index)}
                  >
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ide-muted" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-ide-text">{place.name}</span>
                      {place.address ? (
                        <span className="block truncate text-ide-muted">{place.address}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
                {isFetching && !places.length ? (
                  <li className="flex items-center gap-2 px-3 py-2 text-xs text-ide-muted">
                    <Spinner className="h-3.5 w-3.5" />
                    {t('places.searching')}
                  </li>
                ) : null}
              </ul>
              <p className="border-t border-ide-border px-3 py-1 text-[10px] text-ide-muted">
                © OpenStreetMap
              </p>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
