import { photonLang, toPlaceSuggestions } from './places.util';

describe('toPlaceSuggestions', () => {
  it('builds one line per place and drops duplicates and points without coordinates', () => {
    const places = toPlaceSuggestions([
      {
        geometry: { coordinates: [30.52, 50.45] },
        properties: { name: 'Arsenalna', street: 'Ivana Mazepy St', housenumber: '2', city: 'Kyiv', country: 'Ukraine' },
      },
      {
        geometry: { coordinates: [30.52, 50.45] },
        properties: { name: 'Arsenalna', street: 'Ivana Mazepy St', housenumber: '2', city: 'Kyiv', country: 'Ukraine' },
      },
      { properties: { name: 'Nowhere' } },
      { geometry: { coordinates: [30.5, 50.4] }, properties: { name: 'Kyiv', city: 'Kyiv', country: 'Ukraine' } },
    ]);
    expect(places.map((p) => p.label)).toEqual([
      'Arsenalna, Ivana Mazepy St 2, Kyiv, Ukraine',
      'Kyiv, Ukraine',
    ]);
    expect(places[0]).toMatchObject({ lat: 50.45, lon: 30.52 });
  });
});

describe('photonLang', () => {
  it('passes supported languages and leaves others to local names', () => {
    expect(photonLang('en-US')).toBe('en');
    expect(photonLang('uk')).toBeNull();
    expect(photonLang(undefined)).toBeNull();
  });
});
