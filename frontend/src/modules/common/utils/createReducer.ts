export default function createReducer<TState>(
    defaultState: TState,
    handlers: Record<string, (state: TState, action: { type: string; payload?: unknown }) => TState>
) {
    return function reducer(state = defaultState, action: { type: string; payload?: unknown }): TState {
        if (handlers[action.type]) {
            return handlers[action.type](state, action);
        }
        return state;
    };
}
