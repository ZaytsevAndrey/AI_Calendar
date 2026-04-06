import React from 'react';
import 'styles/global.scss';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { PersistGate } from 'redux-persist/integration/react';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import App from './App';
import { store, persistor } from './store';

const root = createRoot(document.getElementById('root')!);

root.render(
    <React.StrictMode>
        <Provider store={store}>
            <PersistGate loading={null} persistor={persistor}>
                <BrowserRouter>
                    <App />
                    <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} />
                </BrowserRouter>
            </PersistGate>
        </Provider>
    </React.StrictMode>
);
