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
  const hash = window.location.hash.replace(/^#\/?/, "") || "dashboard";
  return VALID_ROUTES.includes(hash as Route) ? (hash as Route) : "dashboard";
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
