/**
 * Filament editing state: the set being edited, its edit history (undo /
 * redo), the active tool and a control-point drag in progress. Edits are pure
 * functions of `filaments/editSession`; each one is an undo step, a whole drag
 * included.
 */

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { Rgba } from "@/api/types";
import type { XYZ } from "@/filaments/curves";
import type { InsertMode } from "@/filaments/editing";
import {
  historyOf,
  movePoint,
  record,
  redo as redoHistory,
  undo as undoHistory,
  type EditContext,
  type EditState,
  type History,
} from "@/filaments/editSession";

export type FilamentTool = "view" | "trace" | "cut";

export interface EditingFilaments {
  runName: string;
  objectName: string;
  userId: string;
  sessionId: string;
  color: Rgba;
  /** Not saved yet (started with "New"). */
  isNew: boolean;
}

interface Drag {
  id: number;
  index: number;
  /** The state before the drag (the undo step's). */
  start: EditState;
}

interface State {
  editing: EditingFilaments | null;
  ctx: EditContext;
  history: History;
  /** The state last saved (or loaded): unsaved changes are anything else. */
  saved: EditState | null;
  tool: FilamentTool;
  insertMode: InsertMode;
  drag: Drag | null;
  /** The last edit's problem, shown to the user. */
  message: string | null;
}

type Action =
  | {
      type: "START";
      editing: EditingFilaments;
      ctx: EditContext;
      state: EditState;
    }
  | { type: "STOP" }
  | { type: "SET_TOOL"; tool: FilamentTool }
  | { type: "SET_INSERT_MODE"; mode: InsertMode }
  | {
      type: "EDIT";
      label: string;
      edit: (state: EditState, ctx: EditContext) => EditState;
    }
  | { type: "SET_ACTIVE"; id: number }
  | { type: "BEGIN_DRAG"; id: number; index: number }
  | { type: "DRAG"; point: XYZ }
  | { type: "END_DRAG" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SAVED"; editing: EditingFilaments }
  | { type: "MESSAGE"; message: string | null };

const EMPTY: EditState = {
  filaments: new Map(),
  pending: new Map(),
  activeId: 1,
};

const initialState: State = {
  editing: null,
  ctx: { step: 10, radius: null },
  history: historyOf(EMPTY),
  saved: null,
  tool: "view",
  insertMode: "append",
  drag: null,
  message: null,
};

function endDrag(state: State): State {
  const { drag, history } = state;
  if (!drag) return state;
  if (history.state === drag.start) return { ...state, drag: null };
  return {
    ...state,
    drag: null,
    history: record(
      { ...history, state: drag.start },
      "Move filament point",
      history.state,
    ),
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "START":
      return {
        ...initialState,
        editing: action.editing,
        ctx: action.ctx,
        history: historyOf(action.state),
        saved: action.state,
        tool: "trace",
        insertMode: state.insertMode,
      };
    case "STOP":
      return { ...initialState, insertMode: state.insertMode };
    case "SET_TOOL":
      return { ...endDrag(state), tool: action.tool };
    case "SET_INSERT_MODE":
      return { ...state, insertMode: action.mode };
    case "EDIT": {
      if (!state.editing) return state;
      const base = endDrag(state);
      try {
        const next = action.edit(base.history.state, base.ctx);
        return {
          ...base,
          history: record(base.history, action.label, next),
          message: null,
        };
      } catch (e) {
        return { ...base, message: e instanceof Error ? e.message : String(e) };
      }
    }
    case "SET_ACTIVE": {
      const h = state.history;
      if (h.state.activeId === action.id) return state;
      // Selecting a filament is not an undo step.
      return {
        ...state,
        history: { ...h, state: { ...h.state, activeId: action.id } },
      };
    }
    case "BEGIN_DRAG":
      return {
        ...endDrag(state),
        drag: {
          id: action.id,
          index: action.index,
          start: state.history.state,
        },
      };
    case "DRAG": {
      const { drag, history } = state;
      if (!drag) return state;
      try {
        const next = movePoint(
          history.state,
          state.ctx,
          drag.id,
          drag.index,
          action.point,
        );
        return { ...state, history: { ...history, state: next } };
      } catch (e) {
        return {
          ...state,
          message: e instanceof Error ? e.message : String(e),
        };
      }
    }
    case "END_DRAG":
      return endDrag(state);
    case "UNDO": {
      const base = endDrag(state);
      return { ...base, history: undoHistory(base.history), message: null };
    }
    case "REDO": {
      const base = endDrag(state);
      return { ...base, history: redoHistory(base.history), message: null };
    }
    case "SAVED":
      return { ...state, editing: action.editing, saved: state.history.state };
    case "MESSAGE":
      return { ...state, message: action.message };
  }
}

interface FilamentEditingContextType {
  editing: EditingFilaments | null;
  isEditing: boolean;
  edit: EditState;
  ctx: EditContext;
  tool: FilamentTool;
  insertMode: InsertMode;
  dragging: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  message: string | null;
  start: (
    editing: EditingFilaments,
    ctx: EditContext,
    state: EditState,
  ) => void;
  stop: () => void;
  setTool: (tool: FilamentTool) => void;
  setInsertMode: (mode: InsertMode) => void;
  apply: (
    label: string,
    edit: (state: EditState, ctx: EditContext) => EditState,
  ) => void;
  setActive: (id: number) => void;
  beginDrag: (id: number, index: number) => void;
  dragTo: (point: XYZ) => void;
  endDrag: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: (editing: EditingFilaments) => void;
  setMessage: (message: string | null) => void;
}

const FilamentEditingContext = createContext<FilamentEditingContextType | null>(
  null,
);

export function FilamentEditingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const actions = useMemo(
    () => ({
      start: (editing: EditingFilaments, ctx: EditContext, s: EditState) =>
        dispatch({ type: "START", editing, ctx, state: s }),
      stop: () => dispatch({ type: "STOP" }),
      setTool: (tool: FilamentTool) => dispatch({ type: "SET_TOOL", tool }),
      setInsertMode: (mode: InsertMode) =>
        dispatch({ type: "SET_INSERT_MODE", mode }),
      apply: (
        label: string,
        edit: (s: EditState, ctx: EditContext) => EditState,
      ) => dispatch({ type: "EDIT", label, edit }),
      setActive: (id: number) => dispatch({ type: "SET_ACTIVE", id }),
      beginDrag: (id: number, index: number) =>
        dispatch({ type: "BEGIN_DRAG", id, index }),
      dragTo: (point: XYZ) => dispatch({ type: "DRAG", point }),
      endDrag: () => dispatch({ type: "END_DRAG" }),
      undo: () => dispatch({ type: "UNDO" }),
      redo: () => dispatch({ type: "REDO" }),
      markSaved: (editing: EditingFilaments) =>
        dispatch({ type: "SAVED", editing }),
      setMessage: (message: string | null) =>
        dispatch({ type: "MESSAGE", message }),
    }),
    [],
  );

  const { history } = state;
  const value = useMemo<FilamentEditingContextType>(
    () => ({
      ...actions,
      editing: state.editing,
      isEditing: state.editing !== null,
      edit: history.state,
      ctx: state.ctx,
      tool: state.tool,
      insertMode: state.insertMode,
      dragging: state.drag !== null,
      dirty:
        state.editing !== null &&
        (state.editing.isNew || history.state !== state.saved),
      canUndo: history.undo.length > 0,
      canRedo: history.redo.length > 0,
      undoLabel: history.undo[history.undo.length - 1]?.label ?? null,
      redoLabel: history.redo[history.redo.length - 1]?.label ?? null,
      message: state.message,
    }),
    [actions, state, history],
  );

  return (
    <FilamentEditingContext.Provider value={value}>
      {children}
    </FilamentEditingContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFilamentEditing(): FilamentEditingContextType {
  const context = useContext(FilamentEditingContext);
  if (!context)
    throw new Error(
      "useFilamentEditing must be used within a FilamentEditingProvider",
    );
  return context;
}
