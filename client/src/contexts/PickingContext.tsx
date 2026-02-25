/**
 * Context for managing picking tool state and operations.
 */

import { createContext, useContext, useReducer, useCallback, type ReactNode } from "react";

export type PickingTool = "view" | "add" | "select" | "delete";

export interface EditingPicks {
  runName: string;
  objectName: string;
  userId: string;
  sessionId: string;
  color: [number, number, number, number];
}

export interface PickingPoint {
  id: string; // Unique ID for selection
  x: number;
  y: number;
  z: number;
  instance_id?: number | null;
  score?: number | null;
}

interface PickingState {
  activeTool: PickingTool;
  editingPicks: EditingPicks | null;
  localPoints: PickingPoint[]; // Local copy of points being edited
  selectedPointIds: Set<string>;
  hasUnsavedChanges: boolean;
}

type PickingAction =
  | { type: "SET_TOOL"; tool: PickingTool }
  | { type: "START_EDITING"; picks: EditingPicks; points: PickingPoint[] }
  | { type: "STOP_EDITING" }
  | { type: "ADD_POINT"; point: PickingPoint }
  | { type: "DELETE_POINT"; pointId: string }
  | { type: "DELETE_SELECTED_POINTS" }
  | { type: "SELECT_POINT"; pointId: string; addToSelection: boolean }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_POINTS"; points: PickingPoint[] }
  | { type: "MARK_SAVED" };

const initialState: PickingState = {
  activeTool: "view",
  editingPicks: null,
  localPoints: [],
  selectedPointIds: new Set(),
  hasUnsavedChanges: false,
};

function pickingReducer(state: PickingState, action: PickingAction): PickingState {
  switch (action.type) {
    case "SET_TOOL":
      return { ...state, activeTool: action.tool };

    case "START_EDITING":
      return {
        ...state,
        editingPicks: action.picks,
        localPoints: action.points,
        selectedPointIds: new Set(),
        hasUnsavedChanges: false,
        activeTool: "add", // Switch to add mode when starting to edit
      };

    case "STOP_EDITING":
      return {
        ...state,
        editingPicks: null,
        localPoints: [],
        selectedPointIds: new Set(),
        hasUnsavedChanges: false,
        activeTool: "view",
      };

    case "ADD_POINT":
      return {
        ...state,
        localPoints: [...state.localPoints, action.point],
        hasUnsavedChanges: true,
      };

    case "DELETE_POINT": {
      return {
        ...state,
        localPoints: state.localPoints.filter((p) => p.id !== action.pointId),
        selectedPointIds: new Set([...state.selectedPointIds].filter((id) => id !== action.pointId)),
        hasUnsavedChanges: true,
      };
    }

    case "DELETE_SELECTED_POINTS": {
      const selected = state.selectedPointIds;
      return {
        ...state,
        localPoints: state.localPoints.filter((p) => !selected.has(p.id)),
        selectedPointIds: new Set(),
        hasUnsavedChanges: true,
      };
    }

    case "SELECT_POINT": {
      const newSelection = new Set(action.addToSelection ? state.selectedPointIds : []);
      if (newSelection.has(action.pointId)) {
        newSelection.delete(action.pointId);
      } else {
        newSelection.add(action.pointId);
      }
      return { ...state, selectedPointIds: newSelection };
    }

    case "CLEAR_SELECTION":
      return { ...state, selectedPointIds: new Set() };

    case "SET_POINTS":
      return { ...state, localPoints: action.points, hasUnsavedChanges: true };

    case "MARK_SAVED":
      return { ...state, hasUnsavedChanges: false };

    default:
      return state;
  }
}

interface PickingContextType {
  state: PickingState;
  dispatch: React.Dispatch<PickingAction>;
  setTool: (tool: PickingTool) => void;
  startEditing: (picks: EditingPicks, points: PickingPoint[]) => void;
  stopEditing: () => void;
  addPoint: (point: PickingPoint) => void;
  deletePoint: (pointId: string) => void;
  deleteSelectedPoints: () => void;
  selectPoint: (pointId: string, addToSelection?: boolean) => void;
  clearSelection: () => void;
  markSaved: () => void;
  isEditing: boolean;
}

const PickingContext = createContext<PickingContextType | null>(null);

export function PickingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(pickingReducer, initialState);

  const value: PickingContextType = {
    state,
    dispatch,
    setTool: useCallback((tool) => dispatch({ type: "SET_TOOL", tool }), []),
    startEditing: useCallback((picks, points) => dispatch({ type: "START_EDITING", picks, points }), []),
    stopEditing: useCallback(() => dispatch({ type: "STOP_EDITING" }), []),
    addPoint: useCallback((point) => dispatch({ type: "ADD_POINT", point }), []),
    deletePoint: useCallback((pointId) => dispatch({ type: "DELETE_POINT", pointId }), []),
    deleteSelectedPoints: useCallback(() => dispatch({ type: "DELETE_SELECTED_POINTS" }), []),
    selectPoint: useCallback(
      (pointId, addToSelection = false) => dispatch({ type: "SELECT_POINT", pointId, addToSelection }),
      []
    ),
    clearSelection: useCallback(() => dispatch({ type: "CLEAR_SELECTION" }), []),
    markSaved: useCallback(() => dispatch({ type: "MARK_SAVED" }), []),
    isEditing: state.editingPicks !== null,
  };

  return <PickingContext.Provider value={value}>{children}</PickingContext.Provider>;
}

export function usePicking(): PickingContextType {
  const context = useContext(PickingContext);
  if (!context) {
    throw new Error("usePicking must be used within a PickingProvider");
  }
  return context;
}
