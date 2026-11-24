import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  toast: {
    success: (message: string, title?: string, duration?: number) => void;
    error: (message: string, title?: string, duration?: number) => void;
    warning: (message: string, title?: string, duration?: number) => void;
    info: (message: string, title?: string, duration?: number) => void;
    dismiss: (id: string) => void;
  };
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string, title?: string, duration: number = 4000) => {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const newToast: ToastItem = { id, type, title, message, duration };

      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
      }
    },
    [dismiss]
  );

  const toastMethods = useMemo(
    () => ({
      success: (message: string, title?: string, duration?: number) =>
        addToast('success', message, title, duration),
      error: (message: string, title?: string, duration?: number) =>
        addToast('error', message, title, duration),
      warning: (message: string, title?: string, duration?: number) =>
        addToast('warning', message, title, duration),
      info: (message: string, title?: string, duration?: number) =>
        addToast('info', message, title, duration),
      dismiss,
    }),
    [addToast, dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast: toastMethods }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue['toast'] => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context.toast;
};

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <aside
      aria-live="polite"
      aria-label="Notification banners"
      className="fixed bottom-4 right-3 sm:right-4 left-3 sm:left-auto z-[60] flex flex-col space-y-2 max-w-sm sm:w-full pointer-events-none"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex items-start space-x-3 p-3.5 rounded-xl bg-forge-900/95 border border-white/[0.12] shadow-2xl backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-2"
        >
          <div className="shrink-0 mt-0.5">
            {item.type === 'success' && (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
            {item.type === 'error' && (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            )}
            {item.type === 'warning' && (
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            )}
            {item.type === 'info' && (
              <Info className="w-4 h-4 text-sky-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            {item.title && (
              <p className="text-xs font-semibold text-slate-100 tracking-tight leading-snug">
                {item.title}
              </p>
            )}
            <p className="text-xs text-slate-300 leading-relaxed break-words">
              {item.message}
            </p>
          </div>
          <button
            onClick={() => onDismiss(item.id)}
            className="shrink-0 text-slate-400 hover:text-slate-200 p-0.5 rounded transition"
            aria-label="Close notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </aside>
  );
};
