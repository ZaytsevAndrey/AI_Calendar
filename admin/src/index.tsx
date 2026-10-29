import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from './router';
import { App } from './App';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider>
      <App />
    </RouterProvider>
  </React.StrictMode>,
);
