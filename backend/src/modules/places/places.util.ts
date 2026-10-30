export type PlaceSuggestion = {
  /** One line to store as the task location. */
  label: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
};

/** Photon answers in these languages; others fall back to local names. */
const PHOTON_LANGS = new Set(['en', 'de', 'fr', 'it']);

export function photonLang(lang?: string): string | null {
  const short = (lang ?? '').slice(0, 2).toLowerCase();
  return PHOTON_LANGS.has(short) ? short : null;
}

/** GeoJSON features → one-line places, duplicates dropped. */
export function toPlaceSuggestions(features: PhotonFeature[]): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const p = feature.properties ?? {};
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    const name = p.name || street || p.city || '';
    if (!name) continue;
    const address = unique([street, p.city, p.country].filter(Boolean) as string[])
      .filter((part) => part !== name)
      .join(', ');
    const label = address ? `${name}, ${address}` : name;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, name, address, lat, lon });
  }
  return out;
}

function unique(parts: string[]): string[] {
  return parts.filter((part, index) => parts.indexOf(part) === index);
}
