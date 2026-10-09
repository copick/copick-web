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
import type { SegmentationType } from "@/api/types";

// Types for selected entities
export interface PickSelection {
  objectName: string;
  userId: string;
  sessionId: string;
  visible: boolean;
  /** Colour points by instance ID (default for filament objects). */
  colorByInstance?: boolean;
}

/** How a panoptic segmentation is drawn: object labels, instances, or both. */
export type PanopticMode = "objects" | "instances" | "both";

export interface SegmentationDisplay {
  /** Panoptic only. */
  panopticMode: PanopticMode;
  /** Instance IDs drawn transparent (kept small: idetik scans its lookup table per fragment). */
  hiddenIds: number[];
  /** When set, only this instance ID is drawn. */
  soloId: number | null;
  /** The instance outlined in the views (picked in a view or in the instance browser). */
  selectedId: number | null;
}

export interface SegmentationSelection extends SegmentationDisplay {
  name: string;
  userId: string;
  sessionId: string;
  voxelSize: number;
  segmentationType: SegmentationType;
  visible: boolean;
}

export type SegmentationIdentity = Pick<
  SegmentationSelection,
  "name" | "userId" | "sessionId" | "voxelSize" | "segmentationType"
>;

export interface FilamentsSelection {
  objectName: string;
  userId: string;
  sessionId: string;
  visible: boolean;
  /** Highlighted filament (instance ID). */
  selectedId: number | null;
}

/** Since instance and panoptic segmentations, the type is part of a segmentation's identity. */
// eslint-disable-next-line react-refresh/only-export-components
export function segmentationKey(seg: SegmentationIdentity): string {
  return `${seg.segmentationType}:${seg.name}:${seg.userId}:${seg.sessionId}:${seg.voxelSize}`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function filamentsKey(f: {
  objectName: string;
  userId: string;
  sessionId: string;
}): string {
  return `${f.objectName}:${f.userId}:${f.sessionId}`;
}

export const MAX_HIDDEN_IDS = 62;

const DEFAULT_DISPLAY: SegmentationDisplay = {
  panopticMode: "both",
  hiddenIds: [],
  soloId: null,
  selectedId: null,
};

// State type
export interface CopickState {
  selectedRunName: string | null;
  selectedVoxelSize: number | null;
  selectedTomoType: string | null;
  selectedPicks: PickSelection[];
  selectedSegmentations: SegmentationSelection[];
  selectedFilaments: FilamentsSelection[];
}

// Action types
type CopickAction =
  | { type: "SELECT_RUN"; runName: string }
  | {
      type: "SELECT_TOMOGRAM";
      runName: string;
      voxelSize: number;
      tomoType: string;
    }
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
      type: "SET_PICK_COLOR_BY_INSTANCE";
      objectName: string;
      userId: string;
      sessionId: string;
      value: boolean;
    }
  | { type: "TOGGLE_SEGMENTATION_VISIBILITY"; key: string }
  | { type: "ADD_SEGMENTATION"; seg: SegmentationIdentity }
  | { type: "REMOVE_SEGMENTATION"; key: string }
  | {
      type: "UPDATE_SEGMENTATION";
      key: string;
      patch: Partial<SegmentationDisplay>;
    }
  | { type: "SET_SEGMENTATIONS"; segmentations: SegmentationSelection[] }
  | { type: "TOGGLE_FILAMENTS_VISIBILITY"; key: string }
  | {
      type: "ADD_FILAMENTS";
      filaments: Omit<FilamentsSelection, "visible" | "selectedId">;
    }
  | { type: "SELECT_FILAMENT"; key: string; instanceId: number | null };

// Initial state
const initialState: CopickState = {
  selectedRunName: null,
  selectedVoxelSize: null,
  selectedTomoType: null,
  selectedPicks: [],
  selectedSegmentations: [],
  selectedFilaments: [],
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
      // Run, voxel spacing and tomogram change together, so browsing the tree never blanks the viewer. Overlays
      // belong to a run: they are kept for another tomogram of the same run and reset for a different run.
      if (action.runName !== state.selectedRunName) {
        return {
          ...initialState,
          selectedRunName: action.runName,
          selectedVoxelSize: action.voxelSize,
          selectedTomoType: action.tomoType,
        };
      }
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

    case "SET_PICK_COLOR_BY_INSTANCE":
      return {
        ...state,
        selectedPicks: state.selectedPicks.map((p) =>
          p.objectName === action.objectName &&
          p.userId === action.userId &&
          p.sessionId === action.sessionId
            ? { ...p, colorByInstance: action.value }
            : p,
        ),
      };

    case "TOGGLE_SEGMENTATION_VISIBILITY":
      return {
        ...state,
        selectedSegmentations: state.selectedSegmentations.map((s) =>
          segmentationKey(s) === action.key ? { ...s, visible: !s.visible } : s,
        ),
      };

    case "ADD_SEGMENTATION":
      return {
        ...state,
        selectedSegmentations: [
          ...state.selectedSegmentations,
          { ...action.seg, ...DEFAULT_DISPLAY, visible: true },
        ],
      };

    case "REMOVE_SEGMENTATION":
      return {
        ...state,
        selectedSegmentations: state.selectedSegmentations.filter(
          (s) => segmentationKey(s) !== action.key,
        ),
      };

    case "UPDATE_SEGMENTATION":
      return {
        ...state,
        selectedSegmentations: state.selectedSegmentations.map((s) => {
          if (segmentationKey(s) !== action.key) return s;
          const next = { ...s, ...action.patch };
          next.hiddenIds = next.hiddenIds.slice(0, MAX_HIDDEN_IDS);
          return next;
        }),
      };

    case "SET_SEGMENTATIONS":
      return {
        ...state,
        selectedSegmentations: action.segmentations,
      };

    case "TOGGLE_FILAMENTS_VISIBILITY":
      return {
        ...state,
        selectedFilaments: state.selectedFilaments.map((f) =>
          filamentsKey(f) === action.key ? { ...f, visible: !f.visible } : f,
        ),
      };

    case "ADD_FILAMENTS": {
      const key = filamentsKey(action.filaments);
      if (state.selectedFilaments.some((f) => filamentsKey(f) === key))
        return {
          ...state,
          selectedFilaments: state.selectedFilaments.map((f) =>
            filamentsKey(f) === key ? { ...f, visible: true } : f,
          ),
        };
      return {
        ...state,
        selectedFilaments: [
          ...state.selectedFilaments,
          { ...action.filaments, visible: true, selectedId: null },
        ],
      };
    }

    case "SELECT_FILAMENT":
      return {
        ...state,
        selectedFilaments: state.selectedFilaments.map((f) =>
          filamentsKey(f) === action.key
            ? { ...f, selectedId: action.instanceId }
            : f,
        ),
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
  selectTomogram: (
    runName: string,
    voxelSize: number,
    tomoType: string,
  ) => void;
  clearSelection: () => void;
  togglePickVisibility: (
    objectName: string,
    userId: string,
    sessionId: string,
  ) => void;
  addPick: (pick: Omit<PickSelection, "visible">) => void;
  setPickColorByInstance: (
    objectName: string,
    userId: string,
    sessionId: string,
    value: boolean,
  ) => void;
  toggleSegmentationVisibility: (key: string) => void;
  addSegmentation: (seg: SegmentationIdentity) => void;
  updateSegmentation: (
    key: string,
    patch: Partial<SegmentationDisplay>,
  ) => void;
  toggleFilamentsVisibility: (key: string) => void;
  addFilaments: (f: Omit<FilamentsSelection, "visible" | "selectedId">) => void;
  selectFilament: (key: string, instanceId: number | null) => void;
}

const CopickContext = createContext<CopickContextType | null>(null);
/** The project id alone, so reading it does not re-render on every selection change. */
const ProjectIdContext = createContext<string | null>(null);

// Provider component
export function CopickProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(copickReducer, initialState);

  const actions = useMemo<Omit<CopickContextType, "projectId" | "state">>(
    () => ({
      dispatch,
      selectRun: (runName) => dispatch({ type: "SELECT_RUN", runName }),
      selectTomogram: (runName, voxelSize, tomoType) =>
        dispatch({ type: "SELECT_TOMOGRAM", runName, voxelSize, tomoType }),
      clearSelection: () => dispatch({ type: "CLEAR_SELECTION" }),
      togglePickVisibility: (objectName, userId, sessionId) =>
        dispatch({
          type: "TOGGLE_PICK_VISIBILITY",
          objectName,
          userId,
          sessionId,
        }),
      addPick: (pick) => dispatch({ type: "ADD_PICK", pick }),
      setPickColorByInstance: (objectName, userId, sessionId, value) =>
        dispatch({
          type: "SET_PICK_COLOR_BY_INSTANCE",
          objectName,
          userId,
          sessionId,
          value,
        }),
      toggleSegmentationVisibility: (key) =>
        dispatch({ type: "TOGGLE_SEGMENTATION_VISIBILITY", key }),
      addSegmentation: (seg) => dispatch({ type: "ADD_SEGMENTATION", seg }),
      updateSegmentation: (key, patch) =>
        dispatch({ type: "UPDATE_SEGMENTATION", key, patch }),
      toggleFilamentsVisibility: (key) =>
        dispatch({ type: "TOGGLE_FILAMENTS_VISIBILITY", key }),
      addFilaments: (filaments) =>
        dispatch({ type: "ADD_FILAMENTS", filaments }),
      selectFilament: (key, instanceId) =>
        dispatch({ type: "SELECT_FILAMENT", key, instanceId }),
    }),
    [],
  );

  const value = useMemo(
    () => ({ projectId, state, ...actions }),
    [projectId, state, actions],
  );

  return (
    <ProjectIdContext.Provider value={projectId}>
      <CopickContext.Provider value={value}>{children}</CopickContext.Provider>
    </ProjectIdContext.Provider>
  );
}

// Hook to use the context
// eslint-disable-next-line react-refresh/only-export-components
export function useCopick(): CopickContextType {
  const context = useContext(CopickContext);
  if (!context) {
    throw new Error("useCopick must be used within a CopickProvider");
  }
  return context;
}

// Hook to access the current project id without subscribing to selection state.
// eslint-disable-next-line react-refresh/only-export-components
export function useProjectId(): string {
  const projectId = useContext(ProjectIdContext);
  if (projectId === null) {
    throw new Error("useProjectId must be used within a CopickProvider");
  }
  return projectId;
}

/**
 * Selective hook to subscribe only to tomogram selection state.
 * This prevents re-renders when picks/segmentation visibility changes,
 * which would otherwise cause the viewer to reload.
 */
// eslint-disable-next-line react-refresh/only-export-components
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
