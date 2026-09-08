import React from 'react';
import { toast, ToastOptions } from 'react-toastify';

export type ToastPayload = string | { title: string; detail?: string | null };

const defaultOptions: ToastOptions = {
  position: 'top-right',
  autoClose: 4000,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
};

function ToastBody({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="app-toast-body">
      <p className="app-toast-title">{title}</p>
      <p className="app-toast-detail">{detail}</p>
    </div>
  );
}

function toContent(payload: ToastPayload): React.ReactNode {
  if (typeof payload === 'string') {
    return payload;
  }
  const detail = payload.detail?.trim();
  if (!detail) {
    return payload.title;
  }
  return <ToastBody title={payload.title} detail={detail} />;
}

function show(
  kind: 'success' | 'error' | 'info' | 'warning',
  payload: ToastPayload,
  options?: ToastOptions,
) {
  const extra: ToastOptions = kind === 'error' ? { autoClose: 6000 } : {};
  toast[kind](toContent(payload), { ...defaultOptions, ...extra, ...options });
}

export const showSuccessToast = (payload: ToastPayload, options?: ToastOptions) => {
  show('success', payload, options);
};

export const showErrorToast = (payload: ToastPayload, options?: ToastOptions) => {
  show('error', payload, options);
};

export const showInfoToast = (payload: ToastPayload, options?: ToastOptions) => {
  show('info', payload, options);
};

export const showWarningToast = (payload: ToastPayload, options?: ToastOptions) => {
  show('warning', payload, options);
};
