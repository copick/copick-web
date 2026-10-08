import { CopickProvider } from "@/contexts/CopickContext";
import { PickingProvider } from "@/contexts/PickingContext";
import { FilamentEditingProvider } from "@/contexts/FilamentEditingContext";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { ViewerBridgeProvider } from "@/contexts/ViewerBridgeProvider";
import { LayerStatusProvider } from "@/contexts/LayerStatusContext";
import { AppLayout } from "@/components/layout/AppLayout";

function App() {
  return (
    <CopickProvider>
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

export default App;
