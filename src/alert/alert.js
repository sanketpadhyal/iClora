import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './alert.css';

const AlertContext = createContext(null);
const ENTER_ANIMATION_MS = 520;
const EXIT_ANIMATION_MS = 520;

const DEFAULT_ALERT = {
  open: false,
  title: '',
  message: '',
  type: 'info',
};

export function AlertProvider({ children }) {
  const [alertState, setAlertState] = useState(DEFAULT_ALERT);
  const closeTimerRef = useRef(null);

  const clearAlertTimer = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const hideAlert = useCallback(() => {
    clearAlertTimer();
    setAlertState((prev) => ({ ...prev, open: false }));
  }, [clearAlertTimer]);

  const showAlert = useCallback(
    ({ title, message, type = 'info', duration = 1500 }) => {
      clearAlertTimer();
      setAlertState({
        open: true,
        title: title || 'Notice',
        message: message || '',
        type,
      });

      if (duration > 0) {
        closeTimerRef.current = window.setTimeout(() => {
          setAlertState((prev) => ({ ...prev, open: false }));
          closeTimerRef.current = null;
        }, duration + ENTER_ANIMATION_MS);
      }
    },
    [clearAlertTimer]
  );

  const value = useMemo(
    () => ({
      showAlert,
      hideAlert,
    }),
    [showAlert, hideAlert]
  );

  return (
    <AlertContext.Provider value={value}>
      {children}
      <GlobalAlert alertState={alertState} onClose={hideAlert} />
    </AlertContext.Provider>
  );
}

export function useAlert() {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used inside AlertProvider');
  }
  return context;
}

function GlobalAlert({ alertState, onClose }) {
  const [isMounted, setIsMounted] = useState(false);
  const [phase, setPhase] = useState('idle');
  const exitTimerRef = useRef(null);

  useEffect(() => {
    if (alertState.open) {
      if (exitTimerRef.current) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      setIsMounted(true);
      setPhase('enter');
      return;
    }

    setPhase('exit');
    if (isMounted) {
      exitTimerRef.current = window.setTimeout(() => {
        setIsMounted(false);
        setPhase('idle');
        exitTimerRef.current = null;
      }, EXIT_ANIMATION_MS);
    }
  }, [alertState.open, isMounted]);

  useEffect(
    () => () => {
      if (exitTimerRef.current) {
        window.clearTimeout(exitTimerRef.current);
      }
    },
    []
  );

  if (!isMounted) return null;

  const alert = (
    <div className="iclora-alert-root" role="status" aria-live="polite">
      <section
        className={`iclora-alert-card iclora-alert-card--${phase} iclora-alert-card--${alertState.type}`}
        onAnimationEnd={() => {
          if (phase === 'enter') {
            setPhase('idle');
          }
        }}
      >
        <div className="iclora-alert-card__inner">
          <div>
            <h4 className="iclora-alert-card__title">{alertState.title}</h4>
            {alertState.message ? <p className="iclora-alert-card__message">{alertState.message}</p> : null}
          </div>
          <button type="button" className="iclora-alert-card__close" aria-label="Dismiss alert" onClick={onClose}>
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />
            </svg>
          </button>
        </div>
      </section>
    </div>
  );

  if (typeof document === 'undefined') return alert;
  return createPortal(alert, document.body);
}
