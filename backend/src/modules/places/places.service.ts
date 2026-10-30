import { Injectable, Logger } from '@nestjs/common';
import { photonLang, toPlaceSuggestions, type PlaceSuggestion } from './places.util';

const PHOTON_URL = process.env.PHOTON_URL || 'https://photon.komoot.io/api/';
const LIMIT = 6;
const TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;

/** Place autocomplete over Photon (OpenStreetMap). No key; results are cached. */
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly cache = new Map<string, { at: number; places: PlaceSuggestion[] }>();

  async search(query: string, lang?: string): Promise<PlaceSuggestion[]> {
    const q = query.trim();
    if (q.length < 3 || process.env.E2E_STUB_EXTERNAL === '1') return [];
    const language = photonLang(lang);
    const key = `${language ?? '-'}|${q.toLowerCase()}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.places;

    const url = new URL(PHOTON_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', String(LIMIT));
    if (language) url.searchParams.set('lang', language);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'luefy-calendar/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`photon ${response.status} for "${q}"`);
        return [];
      }
      const body = (await response.json()) as { features?: unknown[] };
      const places = toPlaceSuggestions((body.features ?? []) as never[]);
      if (this.cache.size >= CACHE_MAX) {
        this.cache.delete(this.cache.keys().next().value as string);
      }
      this.cache.set(key, { at: Date.now(), places });
      return places;
    } catch (err) {
      // A slow or down geocoder must not block typing a location by hand.
      this.logger.warn(`photon failed for "${q}": ${(err as Error).message}`);
      return [];
    }
  }
}
