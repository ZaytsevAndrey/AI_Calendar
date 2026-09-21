export const UI_PORT = 3100;
export const API_PORT = 3101;
export const UI_BASE = `http://127.0.0.1:${UI_PORT}`;
export const API_BASE = `http://127.0.0.1:${API_PORT}`;
export const JWT_SECRET = process.env.JWT_SECRET || 'e2e-playwright-secret';
