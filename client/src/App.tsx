import { CopickProvider } from "@/contexts/CopickContext";
import { PickingProvider } from "@/contexts/PickingContext";
import { AppLayout } from "@/components/layout/AppLayout";

function App() {
  return (
    <CopickProvider>
      <PickingProvider>
        <AppLayout />
      </PickingProvider>
    </CopickProvider>
  );
}

export default App;
