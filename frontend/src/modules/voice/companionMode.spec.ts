import {
  COMPANION_VOICE_MODE_KEY,
  FAST_CREATE_AVAILABLE,
  loadCompanionVoiceMode,
  saveCompanionVoiceMode,
} from './companionMode';

/** Frontend Jest runs in node. The switch only needs a storage object. */
function installMemoryStorage(): void {
  const data = new Map<string, string>();
  (globalThis as { window?: { localStorage: Storage } }).window = {
    localStorage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
      clear: () => data.clear(),
      key: (index) => Array.from(data.keys())[index] ?? null,
      get length() {
        return data.size;
      },
    } as Storage,
  };
}

describe('companion voice mode', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('defaults to the assistant dialogue', () => {
    expect(loadCompanionVoiceMode()).toBe('assistant');
  });

  it('remembers fast create in storage for when the engine honors it', () => {
    saveCompanionVoiceMode('fast_create');
    expect(window.localStorage.getItem(COMPANION_VOICE_MODE_KEY)).toBe('fast_create');
  });

  // WP-J1 (D-05): the structured engine does not act on `mode`, so a stored
  // fast_create must not surface as the active mode while the switch is hidden.
  it('loads a stored fast_create as assistant while fast create is hidden', () => {
    saveCompanionVoiceMode('fast_create');
    expect(FAST_CREATE_AVAILABLE).toBe(false);
    expect(loadCompanionVoiceMode()).toBe('assistant');
    expect(window.localStorage.getItem(COMPANION_VOICE_MODE_KEY)).toBe('fast_create');
  });

  it('ignores an unknown stored value', () => {
    window.localStorage.setItem(COMPANION_VOICE_MODE_KEY, 'nope');
    expect(loadCompanionVoiceMode()).toBe('assistant');
  });
});
