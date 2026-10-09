import { useState, useEffect, useCallback } from "react";

export const VALID_ROUTES = [
  "dashboard",
  "fatture",
  "calendario",
  "fattura-cortesia",
  "scadenze",
  "simulatore",
  "impostazioni",
  "guida",
] as const;

export type Route = (typeof VALID_ROUTES)[number];

function getRouteFromHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0] || "dashboard";
  return VALID_ROUTES.includes(hash as Route) ? (hash as Route) : "dashboard";
}

/** Parametro dopo il "?" nell'hash, per esempio `anno` in `#/scadenze?anno=2026`. */
export function getHashParam(name: string): string | null {
  const query = window.location.hash.split("?")[1];
  return query ? new URLSearchParams(query).get(name) : null;
}

export function useRoute() {
  const [currentRoute, setCurrentRoute] = useState<Route>(getRouteFromHash);

  const navigate = useCallback((route: Route) => {
    const newHash = route === "dashboard" ? "#/" : `#/${route}`;
    window.history.pushState({ route }, "", newHash);
    setCurrentRoute(route);
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentRoute(getRouteFromHash());
    };

    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("popstate", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("popstate", handleHashChange);
    };
  }, []);

  return { currentRoute, navigate };
}
