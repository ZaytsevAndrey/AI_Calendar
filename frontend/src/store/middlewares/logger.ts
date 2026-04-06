import { Middleware } from 'redux';

const logger: Middleware = (storeAPI) => (next) => (action) => {
    try {
        const isTypedAction = typeof action === 'object' && action !== null && 'type' in action;

        console.groupCollapsed(
            '%c action',
            'color: #03A9F4; font-weight: bold;',
            isTypedAction ? action.type : '[Unknown Action]'
        );

        console.log('%c prev state', 'color: gray', storeAPI.getState());
        console.log('%c action     ', 'color: blue', action);
        const result = next(action);
        console.log('%c next state', 'color: green', storeAPI.getState());
        console.groupEnd();

        return result;
    } catch (error) {
        console.error('[Logger middleware error]', error);
        return next(action);
    }
};

export default logger;
