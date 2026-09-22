import fs from 'fs';
import path from 'path';
import { routeChunks, prefetchRoute } from './routeChunks';

describe('routeChunks', () => {
    const source = fs.readFileSync(path.join(__dirname, 'routeChunks.ts'), 'utf8');
    const magicNames = [...source.matchAll(/webpackChunkName:\s*"([^"]+)"/g)].map((match) => match[1]);

    it('gives every screen its own lazy chunk', () => {
        const chunks = Object.values(routeChunks);
        const names = chunks.map((chunk) => chunk.chunkName);

        expect(names).toEqual([
            'page-calendar',
            'page-tasks',
            'page-phases',
            'page-habits',
            'page-settings',
            'page-phase-setup',
            'page-login',
            'page-google-callback',
        ]);
        expect(new Set(names).size).toBe(names.length);
        expect(magicNames).toEqual(names);
        for (const chunk of chunks) {
            expect(chunk.Component.$$typeof).toBe(Symbol.for('react.lazy'));
        }
    });

    it('prefetches only paths that have a screen chunk', () => {
        const load = jest.spyOn(routeChunks.settings, 'load').mockImplementation(() =>
            Promise.resolve({ default: () => null }),
        );

        prefetchRoute('/settings');
        prefetchRoute('/login');
        prefetchRoute('/unknown');

        expect(load).toHaveBeenCalledTimes(1);
        load.mockRestore();
    });
});
