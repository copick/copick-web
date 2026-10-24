/**
 * Mouse and keyboard help: a button in the viewer toolbar (or "?") opens a panel listing every binding, by view and
 * by tool. Keep it in step with the handlers it describes: idetik's PanZoomControls / OrbitControls (pan, zoom,
 * rotate), usePaneInteractions (slices), PickingEventHandler and FilamentEditEventHandler (editing).
 */

import { useEffect, useRef, useState } from "react";
import { Box, IconButton, Popover, Tooltip, Typography } from "@mui/material";
import { KeyboardOutlined } from "@mui/icons-material";

type Binding = [keys: string[], action: string];

interface Group {
  title: string;
  bindings: Binding[];
}

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";

// eslint-disable-next-line react-refresh/only-export-components
export const SHORTCUT_GROUPS: Group[] = [
  {
    title: "Slice views (XY, XZ, YZ)",
    bindings: [
      [["Drag"], "Pan"],
      [["Scroll"], "Zoom at the cursor"],
      [["Shift", "Scroll"], "Next / previous slice"],
      [["↑", "↓"], "Next / previous slice (click the view first)"],
      [["Page Up", "Page Down"], "10 slices on"],
      [["Double-click"], "Move the other views' slices there"],
    ],
  },
  {
    title: "3D view",
    bindings: [
      [["Drag"], "Rotate"],
      [["Shift", "Drag"], "Move"],
      [["Middle-drag"], "Move"],
      [["Scroll"], "Zoom"],
    ],
  },
  {
    title: "Editing picks",
    bindings: [
      [["Click"], "Add a point (Add tool)"],
      [["Click"], "Select a point (Select tool)"],
      [["Shift", "Click"], "Add to the selection (Select tool)"],
      [["Click"], "Delete a point (Delete tool)"],
    ],
  },
  {
    title: "Editing filaments",
    bindings: [
      [["Click"], "Add a control point (Trace tool)"],
      [["Drag a handle"], "Move a control point"],
      [["Shift", "Click a handle"], "Remove a control point"],
      [["Click a filament"], "Cut it there (Cut tool)"],
      [[MOD, "Z"], "Undo"],
      [IS_MAC ? ["Shift", "⌘", "Z"] : ["Ctrl", "Y"], "Redo"],
    ],
  },
  {
    title: "Tables",
    bindings: [[["Double-click a row"], "Show / hide it"]],
  },
  {
    title: "Help",
    bindings: [[["?"], "Show / hide this panel"]],
  },
];

function Key({ children }: { children: string }) {
  return (
    <Box
      component="kbd"
      sx={{
        px: 0.6,
        py: 0.1,
        border: 1,
        borderColor: "divider",
        borderRadius: 0.75,
        fontFamily: "inherit",
        fontSize: 11,
        whiteSpace: "nowrap",
        bgcolor: "action.hover",
      }}
    >
      {children}
    </Box>
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
  );
}

export function ShortcutsHelp() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // "?" toggles the panel, except while typing.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key !== "?" ||
        event.metaKey ||
        event.ctrlKey ||
        isTyping(event.target)
      )
        return;
      event.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return (
    <>
      <Tooltip title="Mouse and keyboard (?)">
        <IconButton
          ref={buttonRef}
          size="small"
          aria-label="Mouse and keyboard"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <KeyboardOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={buttonRef.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { p: 1.5, maxWidth: 560 } } }}
      >
        <Box
          role="dialog"
          aria-label="Mouse and keyboard"
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            columnGap: 3,
            rowGap: 1.5,
          }}
        >
          {SHORTCUT_GROUPS.map((group) => (
            <Box key={group.title}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {group.title}
              </Typography>
              {group.bindings.map(([keys, action]) => (
                <Box
                  key={`${keys.join("+")}:${action}`}
                  sx={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 1.5,
                    py: 0.25,
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      color: "text.secondary",
                      fontSize: 12.5,
                    }}
                  >
                    {action}
                  </Typography>
                  <Box sx={{ display: "flex", gap: 0.4, flexShrink: 0 }}>
                    {keys.map((k) => (
                      <Key key={k}>{k}</Key>
                    ))}
                  </Box>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Popover>
    </>
  );
}
