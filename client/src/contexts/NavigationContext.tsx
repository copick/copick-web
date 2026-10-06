/**
 * What the main area shows (the run gallery or the tomogram viewer) and the
 * run search shared by the sidebar's run list and the gallery.
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type MainView = "gallery" | "viewer";

interface NavigationContextType {
  view: MainView;
  showGallery: () => void;
  showViewer: () => void;
  runSearch: string;
  setRunSearch: (value: string) => void;
}

const NavigationContext = createContext<NavigationContextType | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<MainView>("gallery");
  const [runSearch, setRunSearch] = useState("");
  const value = useMemo(
    () => ({
      view,
      showGallery: () => setView("gallery"),
      showViewer: () => setView("viewer"),
      runSearch,
      setRunSearch,
    }),
    [view, runSearch],
  );
  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNavigation(): NavigationContextType {
  const context = useContext(NavigationContext);
  if (!context)
    throw new Error("useNavigation must be used within a NavigationProvider");
  return context;
}
