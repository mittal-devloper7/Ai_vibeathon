import React, { useEffect } from 'react';
import { AlertTriangle, HelpCircle, Loader2 } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isLoading) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-forge-900 border border-white/[0.1] shadow-2xl p-5 sm:p-6 space-y-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <div className="flex items-start space-x-3.5">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
              danger
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            }`}
          >
            {danger ? (
              <AlertTriangle className="w-5 h-5" />
            ) : (
              <HelpCircle className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3
              id="confirm-modal-title"
              className="text-base font-semibold text-slate-100 tracking-tight"
            >
              {title}
            </h3>
            <div className="mt-1.5 text-xs text-slate-400 leading-relaxed">
              {message}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-white/[0.06]">
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white bg-forge-800 hover:bg-forge-750 border border-white/[0.08] rounded-lg transition disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition shadow-sm flex items-center space-x-1.5 disabled:opacity-50 ${
              danger
                ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-950/40'
                : 'bg-brand-600 hover:bg-brand-500 shadow-brand-950/40'
            }`}
          >
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
