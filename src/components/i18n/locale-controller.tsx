"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { useLocale } from "@/components/i18n/locale-provider";
import {
  localeRefreshRecoveryAction,
  localeRollbackRecoveryAction,
  localeSelectionAction,
  localeSynchronizationTarget,
  tryReadBrowserLocalePreference,
  type Locale,
} from "@/i18n/locale";
import {
  createPublicApiRequestDeadline,
  PUBLIC_API_REQUEST_TIMEOUT_MS,
} from "@/lib/public-api-request";

type LocaleRequestState =
  | { status: "idle" }
  | {
      localeAtStart: Locale;
      requestId: number;
      status: "error" | "submitting";
    }
  | {
      localeAtStart: Locale;
      requestId: number;
      status: "recovering" | "refreshing";
      targetLocale: Locale;
    };

type LocaleRefreshWaiter = {
  requestId: number;
  resolve: (result: LocaleRefreshWaitResult) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
  transitionObserved: boolean;
};

type LocaleRefreshWaitResult =
  | { locale: Locale | null; pageLocale: Locale | null; status: "settled" }
  | { status: "timed_out" };

const initialRequestState: LocaleRequestState = { status: "idle" };

type LocaleControls = {
  disabled: boolean;
  requestPending: boolean;
  requestState: LocaleRequestState;
  selectLocale: (locale: Locale) => Promise<void>;
  showError: boolean;
};

const LocaleControllerContext = createContext<LocaleControls | null>(null);
const LocaleRenderReceiptContext = createContext<
  ((locale: Locale) => () => void) | null
>(null);

export function LocaleControllerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = JSON.stringify([pathname, searchParams?.toString() ?? ""]);
  const { locale } = useLocale();
  const [pageReceipt, setPageReceipt] = useState<{ locale: Locale } | null>(null);
  const pageReceiptRef = useRef<{ locale: Locale } | null>(null);
  const pageLocale = pageReceipt?.locale ?? null;
  const reportPageLocale = useCallback((renderedPageLocale: Locale) => {
    const receipt = { locale: renderedPageLocale };
    pageReceiptRef.current = receipt;
    setPageReceipt(receipt);
    // A replaced or hidden page may clean up after a new page committed.
    return () => {
      if (pageReceiptRef.current === receipt) pageReceiptRef.current = null;
      setPageReceipt((current) => current === receipt ? null : current);
    };
  }, []);
  const [requestState, setRequestState] =
    useState<LocaleRequestState>(initialRequestState);
  const requestAbortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const reloadObligationRequestIdRef = useRef<number | null>(null);
  const localeRefreshWaiterRef = useRef<LocaleRefreshWaiter | null>(null);
  const operationPhaseRef = useRef<"submitting" | "refreshing" | "recovering" | null>(null);
  const committedRouteRef = useRef(routeKey);
  const lastSynchronizationRef = useRef<string | null>(null);
  const recheckOnSettlementRef = useRef(false);
  const [settlementVersion, setSettlementVersion] = useState(0);
  const [pending, startTransition] = useTransition();
  const requestPending =
    requestState.status === "recovering" ||
    requestState.status === "refreshing" ||
    (requestState.status === "submitting" &&
      requestState.localeAtStart === locale);
  const showError =
    requestState.status === "error" &&
    requestState.localeAtStart === locale;

  useEffect(
    () => () => {
      if (
        reloadObligationRequestIdRef.current === requestIdRef.current ||
        operationPhaseRef.current === "refreshing" ||
        operationPhaseRef.current === "recovering"
      ) {
        return;
      }
      requestIdRef.current += 1;
      requestAbortControllerRef.current?.abort();
      requestAbortControllerRef.current = null;
      operationPhaseRef.current = null;
      // A committed server locale retires a stale POST/error, but the single
      // controller keeps its own refresh/recovery owner until settlement.
      setRequestState(initialRequestState);
    },
    [locale],
  );

  useEffect(() => {
    const waiter = localeRefreshWaiterRef.current;
    if (waiter === null) {
      return;
    }
    if (pending) {
      waiter.transitionObserved = true;
      return;
    }
    if (!waiter.transitionObserved) {
      return;
    }

    localeRefreshWaiterRef.current = null;
    if (waiter.timeoutId !== undefined) {
      clearTimeout(waiter.timeoutId);
    }
    // Receipt registration happens in the child's commit effect. Read that
    // same commit directly, rather than a prior render's state closure.
    waiter.resolve({ locale, pageLocale: pageReceiptRef.current?.locale ?? null, status: "settled" });
  }, [locale, pageLocale, pending]);

  useEffect(
    () => () => {
      if (reloadObligationRequestIdRef.current !== requestIdRef.current) {
        requestIdRef.current += 1;
        requestAbortControllerRef.current?.abort();
        requestAbortControllerRef.current = null;
        operationPhaseRef.current = null;
      }
      const waiter = localeRefreshWaiterRef.current;
      localeRefreshWaiterRef.current = null;
      if (waiter?.timeoutId !== undefined) {
        clearTimeout(waiter.timeoutId);
      }
      waiter?.resolve({ locale: null, pageLocale: null, status: "settled" });
    },
    [],
  );

  async function changeLocale(nextLocale: Locale, action: "persist" | "refresh") {
    if (
      reloadObligationRequestIdRef.current !== null ||
      pending ||
      requestAbortControllerRef.current !== null
    ) {
      return;
    }

    const abortController = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestAbortControllerRef.current = abortController;
    requestIdRef.current = requestId;
    const deadline = createPublicApiRequestDeadline(abortController.signal);
    const requestIsCurrent = () =>
      !abortController.signal.aborted && requestId === requestIdRef.current;

    try {
      if (action === "persist") {
        operationPhaseRef.current = "submitting";
        setRequestState({
          localeAtStart: locale,
          requestId,
          status: "submitting",
        });
        const response = await fetch("/api/preferences/locale", {
          body: JSON.stringify({ locale: nextLocale }),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: deadline.signal,
        });
        if (!requestIsCurrent()) return;
        if (!response.ok) {
          setRequestState({ localeAtStart: locale, requestId, status: "error" });
          return;
        }
      }
      // The preference POST and the subsequent RSC refresh have independent
      // lifetimes. Do not let the JSON request deadline abort recovery work.
      deadline.dispose();

      operationPhaseRef.current = "refreshing";
      setRequestState({
        localeAtStart: locale,
        requestId,
        status: "refreshing",
        targetLocale: nextLocale,
      });
      const refreshResult = await new Promise<LocaleRefreshWaitResult>((resolve) => {
        const waiter: LocaleRefreshWaiter = {
          requestId,
          resolve,
          transitionObserved: false,
        };
        waiter.timeoutId = setTimeout(() => {
          if (localeRefreshWaiterRef.current !== waiter) {
            return;
          }
          localeRefreshWaiterRef.current = null;
          resolve({ status: "timed_out" });
        }, PUBLIC_API_REQUEST_TIMEOUT_MS);
        localeRefreshWaiterRef.current = waiter;
        startTransition(() => {
          // A server refresh keeps the current pathname, query string, and scroll
          // position while rebuilding server-rendered copy from the new cookie.
          router.refresh();
        });
      });
      const refreshTimedOut = refreshResult.status === "timed_out";
      if (action === "refresh") {
        // Cookie synchronization is read-only, including every failure path.
        // An unfinished response must not survive a later explicit selection.
        if (refreshTimedOut) {
          reloadObligationRequestIdRef.current = requestId;
          operationPhaseRef.current = "recovering";
          setRequestState({ localeAtStart: locale, requestId, status: "recovering", targetLocale: nextLocale });
          window.location.reload();
          return;
        }
        if (refreshResult.locale === null) return;
        const preference = tryReadBrowserLocalePreference(() => document.cookie);
        const aligned = preference.status === "available" &&
          localeSynchronizationTarget({
            browserPreference: preference,
            pageLocale: refreshResult.pageLocale,
            renderedLocale: refreshResult.locale,
          }) === null;
        setRequestState(aligned ? initialRequestState : {
          localeAtStart: refreshResult.locale,
          requestId,
          status: "error",
        });
        // A newer Cookie/route gets one latest-state check after settlement;
        // an unchanged failed identity is not automatically retried.
        return;
      }
      let recoveryAction: ReturnType<typeof localeRefreshRecoveryAction>;
      if (refreshResult.status === "timed_out") {
        // Once an RSC refresh exceeds the deadline, its eventual completion can
        // still overwrite the document after rollback. Nothing in this document
        // may cancel the obligation to rebuild from the authoritative cookie.
        reloadObligationRequestIdRef.current = requestId;
        recoveryAction = "recover";
      } else {
        if (refreshResult.locale === null) {
          return;
        }
        recoveryAction = localeRefreshRecoveryAction({
          browserPreference: tryReadBrowserLocalePreference(
            () => document.cookie,
          ),
          refreshedLocale: refreshResult.locale,
          targetLocale: nextLocale,
        });
      }
      if (recoveryAction === "complete") {
        setRequestState(initialRequestState);
        return;
      }
      if (recoveryAction === "recover") {
        operationPhaseRef.current = "recovering";
        setRequestState({
          localeAtStart: locale,
          requestId,
          status: "recovering",
          targetLocale: nextLocale,
        });
        const rollbackDeadline = createPublicApiRequestDeadline(
          abortController.signal,
        );
        let rollbackAction: ReturnType<typeof localeRollbackRecoveryAction> =
          "reload";
        try {
          const rollbackResponse = await fetch("/api/preferences/locale", {
            body: JSON.stringify({ locale }),
            headers: { "content-type": "application/json" },
            method: "POST",
            signal: rollbackDeadline.signal,
          });
          if (
            !requestIsCurrent() &&
            reloadObligationRequestIdRef.current !== requestId
          ) {
            return;
          }
          const rollbackPreference = tryReadBrowserLocalePreference(
            () => document.cookie,
          );
          rollbackAction = localeRollbackRecoveryAction({
            browserPreference: rollbackPreference,
            responseOk: rollbackResponse.ok,
            sourceLocale: locale,
          });
        } catch {
          if (
            !requestIsCurrent() &&
            reloadObligationRequestIdRef.current !== requestId
          ) {
            return;
          }
        } finally {
          rollbackDeadline.dispose();
        }

        if (!refreshTimedOut && rollbackAction === "show_error") {
          setRequestState({
            localeAtStart: locale,
            requestId,
            status: "error",
          });
        } else {
          // A full document load is the only remaining way to make the rendered
          // locale agree with the server's authoritative cookie. reload()
          // preserves the exact pathname, query string, hash, and history entry.
          window.location.reload();
        }
        return;
      }
      setRequestState({
        localeAtStart: locale,
        requestId,
        status: "error",
      });
    } catch (error: unknown) {
      if (
        !requestIsCurrent() ||
        (error instanceof DOMException &&
          error.name === "AbortError" &&
          !deadline.didTimeout())
      ) {
        return;
      }
      setRequestState({
        localeAtStart: locale,
        requestId,
        status: "error",
      });
    } finally {
      deadline.dispose();
      if (
        requestAbortControllerRef.current === abortController &&
        reloadObligationRequestIdRef.current !== requestId
      ) {
        requestAbortControllerRef.current = null;
        operationPhaseRef.current = null;
      }
      setSettlementVersion((version) => version + 1);
    }
  }


  const synchronizeCookie = useEffectEvent((explicitRetry: boolean) => {
    if (reloadObligationRequestIdRef.current !== null) return;
    if (pending || requestAbortControllerRef.current !== null) {
      recheckOnSettlementRef.current ||= explicitRetry;
      return;
    }
    const retry = explicitRetry || recheckOnSettlementRef.current;
    recheckOnSettlementRef.current = false;
    const targetLocale = localeSynchronizationTarget({
      browserPreference: tryReadBrowserLocalePreference(() => document.cookie),
      pageLocale,
      renderedLocale: locale,
    });
    if (targetLocale === null) {
      lastSynchronizationRef.current = null;
      return;
    }
    const identity = JSON.stringify([routeKey, locale, pageLocale, targetLocale]);
    if (!retry && lastSynchronizationRef.current === identity) return;
    lastSynchronizationRef.current = identity;
    void changeLocale(targetLocale, "refresh");
  });

  useEffect(() => {
    if (committedRouteRef.current !== routeKey) {
      committedRouteRef.current = routeKey;
      // A new page may replace a stale preference POST that has not entered
      // refresh/recovery. Never retire an outstanding RSC response this way.
      if (operationPhaseRef.current === "submitting") {
        requestIdRef.current += 1;
        requestAbortControllerRef.current?.abort();
        requestAbortControllerRef.current = null;
        operationPhaseRef.current = null;
        setRequestState(initialRequestState);
      }
    }
    // Run after the route commit, not on prefetch or navigation intent. The
    // cleanup also prevents StrictMode's probe mount from starting a refresh.
    const timer = setTimeout(() => synchronizeCookie(false), 0);
    return () => clearTimeout(timer);
  }, [routeKey, locale, pageLocale, pending, settlementVersion]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => synchronizeCookie(true), 0);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule();
    };
    window.addEventListener("focus", schedule);
    window.addEventListener("pageshow", schedule);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("pageshow", schedule);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  async function selectLocale(nextLocale: Locale) {
    const action = localeSelectionAction({
      browserPreference: tryReadBrowserLocalePreference(() => document.cookie),
      pageLocale,
      renderedLocale: locale,
      targetLocale: nextLocale,
    });
    if (action === "none") return;
    lastSynchronizationRef.current = JSON.stringify([routeKey, locale, pageLocale, nextLocale]);
    await changeLocale(nextLocale, action);
  }


  return (
    <LocaleControllerContext.Provider
      value={{
        disabled: pending || requestPending,
        requestPending,
        requestState,
        selectLocale,
        showError,
      }}
    >
      <LocaleRenderReceiptContext.Provider value={reportPageLocale}>
        {children}
      </LocaleRenderReceiptContext.Provider>
    </LocaleControllerContext.Provider>
  );
}

// This is a receipt for the committed server page, not another preference
// source. A retained root layout cannot reveal a late page payload's locale.
export function LocaleRenderReceipt({ locale }: { locale: Locale }) {
  const reportPageLocale = useContext(LocaleRenderReceiptContext);
  useLayoutEffect(() => reportPageLocale?.(locale), [locale, reportPageLocale]);
  return null;
}

export function useLocaleControls(): LocaleControls {
  const controls = useContext(LocaleControllerContext);
  if (controls === null) {
    throw new Error("Locale controls require a LocaleControllerProvider.");
  }
  return controls;
}
