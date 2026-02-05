import { CopickProvider } from "@/contexts/CopickContext";
import { AppLayout } from "@/components/layout/AppLayout";

function App() {
  return (
    <CopickProvider>
      <AppLayout />
    </CopickProvider>
  );
}

export default App;
