/**
 * Per-project page: scopes the entire app tree under a given project id. Keyed by the project, so opening another
 * project starts from a clean selection, picking and editing state.
 */

import { Navigate, useParams } from "react-router-dom";
import { CopickProvider } from "@/contexts/CopickContext";
import { PickingProvider } from "@/contexts/PickingContext";
import { FilamentEditingProvider } from "@/contexts/FilamentEditingContext";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { ViewerBridgeProvider } from "@/contexts/ViewerBridgeProvider";
import { LayerStatusProvider } from "@/contexts/LayerStatusContext";
import { AppLayout } from "@/components/layout/AppLayout";

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return <Navigate to="/" replace />;
  }

  return (
    <CopickProvider key={projectId} projectId={projectId}>
      <PickingProvider>
        <FilamentEditingProvider>
          <NavigationProvider>
            <ViewerBridgeProvider>
              <LayerStatusProvider>
                <AppLayout />
              </LayerStatusProvider>
            </ViewerBridgeProvider>
          </NavigationProvider>
        </FilamentEditingProvider>
      </PickingProvider>
    </CopickProvider>
  );
}
