import { configureStore } from '@reduxjs/toolkit';
import { thunk } from 'redux-thunk';
import {
    persistStore,
    persistReducer,
    FLUSH,
    REHYDRATE,
    PAUSE,
    PERSIST,
    PURGE,
    REGISTER,
} from 'redux-persist';
import storage from 'redux-persist/lib/storage';
import { combineReducers } from 'redux';
import authReducer from '../modules/auth/slice/authSlice';
import { eventTasksApi } from '../api/eventTasksApi';
import { phasesApi } from '../api/phasesApi';
import { eventsApi } from '../api/eventsApi';
import { userSettingsApi } from '../api/userSettingsApi';
import { habitsApi } from '../api/habitsApi';

import logger from './middlewares/logger';

const persistConfig = {
    key: 'root',
    storage,
    whitelist: ['auth'],
};

const rootReducer = combineReducers({
    auth: authReducer,
    [eventTasksApi.reducerPath]: eventTasksApi.reducer,
    [phasesApi.reducerPath]: phasesApi.reducer,
    [eventsApi.reducerPath]: eventsApi.reducer,
    [userSettingsApi.reducerPath]: userSettingsApi.reducer,
    [habitsApi.reducerPath]: habitsApi.reducer,
});

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: {
                ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
            },
        }).concat(
            thunk,
            logger,
            eventTasksApi.middleware,
            phasesApi.middleware,
            eventsApi.middleware,
            userSettingsApi.middleware,
            habitsApi.middleware,
        ),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
