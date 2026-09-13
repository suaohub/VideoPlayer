import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type FeedbackTone = 'info' | 'success' | 'warning' | 'danger';

export interface AppDialogState {
  title: string;
  message: string;
  tone?: FeedbackTone;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (confirmed: boolean) => void;
}

export interface ToastState {
  id: number;
  message: string;
  tone?: FeedbackTone;
}

export interface AppChoiceOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
}

export interface AppChoiceState {
  title: string;
  message?: string;
  options: AppChoiceOption[];
  resolve: (value: string | null) => void;
}

interface FeedbackContextValue {
  confirm: (options: Omit<AppDialogState, 'resolve'>) => Promise<boolean>;
  choose: (title: string, options: AppChoiceOption[], message?: string) => Promise<string | null>;
  notify: (message: string, tone?: FeedbackTone) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const toneIcon = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

export function AppDialog({ dialog }: { dialog: AppDialogState | null }) {
  if (!dialog) return null;
  const Icon = toneIcon[dialog.tone ?? 'info'];

  return (
    <div className="app-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) dialog.resolve(false);
    }}>
      <section
        className={`app-dialog app-dialog-${dialog.tone ?? 'info'}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="app-dialog-icon"><Icon size={21} strokeWidth={1.9} /></div>
        <div className="app-dialog-content">
          <div className="app-dialog-title-row">
            <h2 id="app-dialog-title">{dialog.title}</h2>
            <button type="button" className="app-dialog-close" aria-label="关闭" onClick={() => dialog.resolve(false)}>
              <X size={16} />
            </button>
          </div>
          <p className="app-dialog-message">{dialog.message}</p>
          <div className="app-dialog-actions">
            {dialog.cancelLabel !== '' && (
              <button type="button" className="app-dialog-button app-dialog-button-secondary" onClick={() => dialog.resolve(false)}>
                {dialog.cancelLabel ?? '取消'}
              </button>
            )}
            <button type="button" autoFocus className={`app-dialog-button app-dialog-button-primary${dialog.tone === 'danger' ? ' is-danger' : ''}`} onClick={() => dialog.resolve(true)}>
              {dialog.confirmLabel ?? '确定'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, 3600);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;
  const Icon = toneIcon[toast.tone ?? 'info'];
  return (
    <div className={`app-toast app-toast-${toast.tone ?? 'info'}`} role="status">
      <Icon size={17} strokeWidth={2} />
      <span>{toast.message}</span>
      <button type="button" aria-label="关闭通知" onClick={onDismiss}><X size={14} /></button>
    </div>
  );
}

export function AppFeedbackProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<AppDialogState | null>(null);
  const [choice, setChoice] = useState<AppChoiceState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const confirm = useCallback((options: Omit<AppDialogState, 'resolve'>) => (
    new Promise<boolean>((resolve) => {
      setDialog({
        ...options,
        resolve: (confirmed) => {
          setDialog(null);
          resolve(confirmed);
        },
      });
    })
  ), []);

  const choose = useCallback((title: string, options: AppChoiceOption[], message?: string) => (
    new Promise<string | null>((resolve) => {
      setChoice({
        title,
        message,
        options,
        resolve: (value) => {
          setChoice(null);
          resolve(value);
        },
      });
    })
  ), []);

  useEffect(() => {
    if (!dialog && !choice) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dialog) dialog.resolve(false);
      else choice?.resolve(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialog, choice]);

  const notify = useCallback((message: string, tone: FeedbackTone = 'info') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  return (
    <FeedbackContext.Provider value={{ confirm, choose, notify }}>
      {children}
      <AppDialog dialog={dialog} />
      {choice && (
        <div className="app-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) choice.resolve(null);
        }}>
          <section className="app-dialog app-choice-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="app-dialog-icon"><Info size={21} strokeWidth={1.9} /></div>
            <div className="app-dialog-content">
              <div className="app-dialog-title-row">
                <h2>{choice.title}</h2>
                <button type="button" className="app-dialog-close" aria-label="关闭" onClick={() => choice.resolve(null)}><X size={16} /></button>
              </div>
              {choice.message && <p className="app-dialog-message">{choice.message}</p>}
              <div className="app-choice-options">
                {choice.options.map((option) => (
                  <button key={option.value} type="button" className="app-choice-option" onClick={() => choice.resolve(option.value)}>
                    <span className="app-choice-option-icon">{option.icon ?? <Info size={17} />}</span>
                    <span className="app-choice-option-copy">
                      <strong>{option.label}</strong>
                      {option.description && <small>{option.description}</small>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </FeedbackContext.Provider>
  );
}

export function useAppFeedback(): FeedbackContextValue {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useAppFeedback must be used inside AppFeedbackProvider');
  return context;
}
