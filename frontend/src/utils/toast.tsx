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

function UndoBody({ title, undoLabel, onUndo }: { title: string; undoLabel: string; onUndo: () => void }) {
  return (
    <div className="app-toast-undo-row">
      <p className="app-toast-title min-w-0 flex-1">{title}</p>
      <button type="button" className="app-toast-undo" onClick={onUndo}>
        {undoLabel}
      </button>
    </div>
  );
}

/**
 * Show «Deleted · Undo» and run `commit` when the toast closes, unless the person pressed Undo.
 * The caller hides the item right away and shows it again from `onUndo`.
 */
export function runWithUndo(options: {
  title: string;
  undoLabel: string;
  commit: () => void | Promise<void>;
  onUndo?: () => void;
  delayMs?: number;
}) {
  let undone = false;
  const id = toast.info(
    <UndoBody
      title={options.title}
      undoLabel={options.undoLabel}
      onUndo={() => {
        undone = true;
        options.onUndo?.();
        toast.dismiss(id);
      }}
    />,
    {
      ...defaultOptions,
      autoClose: options.delayMs ?? 5000,
      closeOnClick: false,
      draggable: false,
      onClose: () => {
        if (!undone) void options.commit();
      },
    },
  );
}
