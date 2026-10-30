import React from 'react';
import './i18n';
import '@fontsource-variable/onest/index.css';
import './styles/tailwind.css';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { PersistGate } from 'redux-persist/integration/react';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './styles/toastify-ide.css';

import App from './App';
import { store, persistor } from './store';
import { registerServiceWorker } from './modules/pwa/registerServiceWorker';
import { applyStoredTheme } from './theme/applyTheme';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';

applyStoredTheme();
registerServiceWorker();

function ThemedToasts() {
    const { theme } = useTheme();
    return (
        <ToastContainer
            position="top-right"
            autoClose={4000}
            hideProgressBar={false}
            newestOnTop
            closeOnClick
            pauseOnHover
            draggable
            theme={theme}
        />
    );
}

const root = createRoot(document.getElementById('root')!);

root.render(
    <React.StrictMode>
        <Provider store={store}>
            <PersistGate loading={null} persistor={persistor}>
                <BrowserRouter>
                    <ThemeProvider>
                        <App />
                        <ThemedToasts />
                    </ThemeProvider>
                </BrowserRouter>
            </PersistGate>
        </Provider>
    </React.StrictMode>
);
