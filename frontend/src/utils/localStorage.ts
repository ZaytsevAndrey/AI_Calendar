export const setLocalStorageItem = (key: string, value: string) => {
    localStorage.setItem(key, value);
    // Dispatch custom event for same-tab changes
    window.dispatchEvent(new CustomEvent('localStorageChange', {
        detail: { key, newValue: value }
    }));
};

export const removeLocalStorageItem = (key: string) => {
    localStorage.removeItem(key);
    // Dispatch custom event for same-tab changes
    window.dispatchEvent(new CustomEvent('localStorageChange', {
        detail: { key, newValue: null }
    }));
};

export const getLocalStorageItem = (key: string): string | null => {
    return localStorage.getItem(key);
}; 