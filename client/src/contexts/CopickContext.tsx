/**
 * Global state context for the copick-web application.
 */

import {
  createContext,
  useContext,
  useReducer,
  useMemo,
  type ReactNode,
} from "react";

// Types for selected entities
export interface PickSelection {
  objectName: string;
  userId: string;
  sessionId: string;
  visible: boolean;
}

export interface SegmentationSelection {
  name: string;
  userId: string;
  sessionId: string;
  voxelSize: number;
  visible: boolean;
}

// State type
export interface CopickState {
  selectedRunName: string | null;
  selectedVoxelSize: number | null;
  selectedTomoType: string | null;
  selectedPicks: PickSelection[];
  selectedSegmentations: SegmentationSelection[];
}

// Action types
type CopickAction =
  | { type: "SELECT_RUN"; runName: string }
  | { type: "SELECT_TOMOGRAM"; voxelSize: number; tomoType: string }
  | { type: "CLEAR_SELECTION" }
  | {
      type: "TOGGLE_PICK_VISIBILITY";
      objectName: string;
      userId: string;
      sessionId: string;
    }
  | { type: "ADD_PICK"; pick: Omit<PickSelection, "visible"> }
  | {
      type: "REMOVE_PICK";
      objectName: string;
      userId: string;
      sessionId: string;
    }
  | { type: "SET_PICKS"; picks: PickSelection[] }
  | {
      type: "TOGGLE_SEGMENTATION_VISIBILITY";
      name: string;
      userId: string;
      sessionId: string;
      voxelSize: number;
    }
  | { type: "ADD_SEGMENTATION"; seg: Omit<SegmentationSelection, "visible"> }
  | {
      type: "REMOVE_SEGMENTATION";
      name: string;
      userId: string;
      sessionId: string;
      voxelSize: number;
    }
  | { type: "SET_SEGMENTATIONS"; segmentations: SegmentationSelection[] };

// Initial state
const initialState: CopickState = {
  selectedRunName: null,
  selectedVoxelSize: null,
  selectedTomoType: null,
  selectedPicks: [],
  selectedSegmentations: [],
};

// Reducer
function copickReducer(state: CopickState, action: CopickAction): CopickState {
  switch (action.type) {
    case "SELECT_RUN":
      return {
        ...initialState,
        selectedRunName: action.runName,
      };

    case "SELECT_TOMOGRAM":
      return {
        ...state,
        selectedVoxelSize: action.voxelSize,
        selectedTomoType: action.tomoType,
      };

    case "CLEAR_SELECTION":
      return initialState;

    case "TOGGLE_PICK_VISIBILITY":
      return {
        ...state,
        selectedPicks: state.selectedPicks.map((p) =>
          p.objectName === action.objectName &&
          p.userId === action.userId &&
          p.sessionId === action.sessionId
            ? { ...p, visible: !p.visible }
            : p,
        ),
      };

    case "ADD_PICK":
      return {
        ...state,
        selectedPicks: [
          ...state.selectedPicks,
          { ...action.pick, visible: true },
        ],
      };

    case "REMOVE_PICK":
      return {
        ...state,
        selectedPicks: state.selectedPicks.filter(
          (p) =>
            !(
              p.objectName === action.objectName &&
              p.userId === action.userId &&
              p.sessionId === action.sessionId
            ),
        ),
      };

    case "SET_PICKS":
      return {
        ...state,
        selectedPicks: action.picks,
      };

    case "TOGGLE_SEGMENTATION_VISIBILITY":
      return {
        ...state,
        selectedSegmentations: state.selectedSegmentations.map((s) =>
          s.name === action.name &&
          s.userId === action.userId &&
          s.sessionId === action.sessionId &&
          s.voxelSize === action.voxelSize
            ? { ...s, visible: !s.visible }
            : s,
        ),
      };

    case "ADD_SEGMENTATION":
      return {
        ...state,
        selectedSegmentations: [
          ...state.selectedSegmentations,
          { ...action.seg, visible: true },
        ],
      };

    case "REMOVE_SEGMENTATION":
      return {
        ...state,
        selectedSegmentations: state.selectedSegmentations.filter(
          (s) =>
            !(
              s.name === action.name &&
              s.userId === action.userId &&
              s.sessionId === action.sessionId &&
              s.voxelSize === action.voxelSize
            ),
        ),
      };

    case "SET_SEGMENTATIONS":
      return {
        ...state,
        selectedSegmentations: action.segmentations,
      };

    default:
      return state;
  }
}

// Context type
interface CopickContextType {
  projectId: string;
  state: CopickState;
  dispatch: React.Dispatch<CopickAction>;
  // Convenience actions
  selectRun: (runName: string) => void;
  selectTomogram: (voxelSize: number, tomoType: string) => void;
  clearSelection: () => void;
  togglePickVisibility: (
    objectName: string,
    userId: string,
    sessionId: string,
  ) => void;
  addPick: (pick: Omit<PickSelection, "visible">) => void;
  toggleSegmentationVisibility: (
    name: string,
    userId: string,
    sessionId: string,
    voxelSize: number,
  ) => void;
  addSegmentation: (seg: Omit<SegmentationSelection, "visible">) => void;
}

const CopickContext = createContext<CopickContextType | null>(null);

// Provider component
export function CopickProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(copickReducer, initialState);

  const actions: CopickContextType = {
    projectId,
    state,
    dispatch,
    selectRun: (runName) => dispatch({ type: "SELECT_RUN", runName }),
    selectTomogram: (voxelSize, tomoType) =>
      dispatch({ type: "SELECT_TOMOGRAM", voxelSize, tomoType }),
    clearSelection: () => dispatch({ type: "CLEAR_SELECTION" }),
    togglePickVisibility: (objectName, userId, sessionId) =>
      dispatch({
        type: "TOGGLE_PICK_VISIBILITY",
        objectName,
        userId,
        sessionId,
      }),
    addPick: (pick) => dispatch({ type: "ADD_PICK", pick }),
    toggleSegmentationVisibility: (name, userId, sessionId, voxelSize) =>
      dispatch({
        type: "TOGGLE_SEGMENTATION_VISIBILITY",
        name,
        userId,
        sessionId,
        voxelSize,
      }),
    addSegmentation: (seg) => dispatch({ type: "ADD_SEGMENTATION", seg }),
  };

  return (
    <CopickContext.Provider value={actions}>{children}</CopickContext.Provider>
  );
}

// Hook to use the context
export function useCopick(): CopickContextType {
  const context = useContext(CopickContext);
  if (!context) {
    throw new Error("useCopick must be used within a CopickProvider");
  }
  return context;
}

// Hook to access the current project id without subscribing to selection state.
export function useProjectId(): string {
  const context = useContext(CopickContext);
  if (!context) {
    throw new Error("useProjectId must be used within a CopickProvider");
  }
  return context.projectId;
}

/**
 * Selective hook to subscribe only to tomogram selection state.
 * This prevents re-renders when picks/segmentation visibility changes,
 * which would otherwise cause the viewer to reload.
 */
export function useTomogramSelection() {
  const { state } = useCopick();
  return useMemo(
    () => ({
      selectedRunName: state.selectedRunName,
      selectedVoxelSize: state.selectedVoxelSize,
      selectedTomoType: state.selectedTomoType,
    }),
    [state.selectedRunName, state.selectedVoxelSize, state.selectedTomoType],
  );
}
