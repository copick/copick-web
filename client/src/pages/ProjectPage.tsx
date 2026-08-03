/**
 * Per-project page: scopes the entire app tree under a given project id.
 */

import { createContext, useCallback, useContext, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { CopickProvider } from "@/contexts/CopickContext";
import { PickingProvider } from "@/contexts/PickingContext";
import { AppLayout } from "@/components/layout/AppLayout";

const ProjectReloadContext = createContext<(() => void) | null>(null);

export function useResetProjectUI(): () => void {
  const reset = useContext(ProjectReloadContext);
  if (!reset) {
    throw new Error("useResetProjectUI must be used within ProjectPage");
  }
  return reset;
}

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [reloadKey, setReloadKey] = useState(0);
  const resetUI = useCallback(() => setReloadKey((k) => k + 1), []);

  if (!projectId) {
    return <Navigate to="/" replace />;
  }

  return (
    <ProjectReloadContext.Provider value={resetUI}>
      <CopickProvider key={reloadKey} projectId={projectId}>
        <PickingProvider>
          <AppLayout />
        </PickingProvider>
      </CopickProvider>
    </ProjectReloadContext.Provider>
  );
}
