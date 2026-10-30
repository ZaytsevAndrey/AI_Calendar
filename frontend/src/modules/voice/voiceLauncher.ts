import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const EVENT = 'luefy:open-voice';
/** Screens that host the voice sheet. Anywhere else, «Помічник» goes to the calendar first. */
const VOICE_PATHS = ['/calendar', '/tasks'];

/** Bottom-nav «Помічник»: open the voice sheet here, or on the calendar when this screen has none. */
export function useOpenVoice(): () => void {
    const location = useLocation();
    const navigate = useNavigate();
    return () => {
        if (VOICE_PATHS.includes(location.pathname)) window.dispatchEvent(new Event(EVENT));
        else navigate('/calendar', { state: { openVoice: true } });
    };
}

/** A screen with a voice sheet listens for «Помічник» and for arrival with `state.openVoice`. */
export function useVoiceLauncher(open: () => void): void {
    const location = useLocation();
    const navigate = useNavigate();
    useEffect(() => {
        const handler = () => open();
        window.addEventListener(EVENT, handler);
        return () => window.removeEventListener(EVENT, handler);
    }, [open]);
    useEffect(() => {
        const state = location.state as { openVoice?: boolean } | null;
        if (!state?.openVoice) return;
        open();
        navigate(location.pathname, { replace: true, state: null });
        // Once per arrival.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.state]);
}
