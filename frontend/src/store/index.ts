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
import userSettingsReducer from '../modules/user-settings/slice/userSettingsSlice';
import { tasksApi } from '../api/tasksApi';
import { phasesApi } from '../api/phasesApi';
import { eventsApi } from '../api/eventsApi';
import { userSettingsApi } from '../api/userSettingsApi';

import logger from './middlewares/logger';

// Log localStorage tokens for debugging
console.log('localStorage auth state:', {
    access_token: localStorage.getItem('access_token'),
    refresh_token: localStorage.getItem('refresh_token')
});

const persistConfig = {
    key: 'root',
    storage,
    whitelist: ['auth', 'userSettings'],
};

const rootReducer = combineReducers({
    auth: authReducer,
    userSettings: userSettingsReducer,
    [tasksApi.reducerPath]: tasksApi.reducer,
    [phasesApi.reducerPath]: phasesApi.reducer,
    [eventsApi.reducerPath]: eventsApi.reducer,
    [userSettingsApi.reducerPath]: userSettingsApi.reducer,
});

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: {
                ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
            },
        }).concat(thunk, logger, tasksApi.middleware, phasesApi.middleware, eventsApi.middleware, userSettingsApi.middleware),
});

// Log initial state for debugging
console.log('Initial Redux state:', store.getState());

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
