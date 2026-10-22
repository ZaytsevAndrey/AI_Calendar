import {
  COMPANION_VOICE_MODE_KEY,
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

  it('remembers fast create', () => {
    saveCompanionVoiceMode('fast_create');
    expect(window.localStorage.getItem(COMPANION_VOICE_MODE_KEY)).toBe('fast_create');
    expect(loadCompanionVoiceMode()).toBe('fast_create');
  });

  it('ignores an unknown stored value', () => {
    window.localStorage.setItem(COMPANION_VOICE_MODE_KEY, 'nope');
    expect(loadCompanionVoiceMode()).toBe('assistant');
  });
});
