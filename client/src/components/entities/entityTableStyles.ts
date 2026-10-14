/** Styles shared by the fixed-layout entity tables (see EntityNameCell). */

/** Table styling shared by the entity tables: fixed layout so names truncate instead of widening the table. */
export const entityTableSx = {
  tableLayout: "fixed",
  width: "100%",
  "& .MuiIconButton-sizeSmall": { p: 0.5 },
} as const;

/** Column widths (px) of the fixed-layout entity tables. */
export const COL = {
  toggle: 36,
  count: 52,
  icon: 30,
} as const;

export function swatchSx(background: string) {
  return {
    width: 12,
    height: 12,
    borderRadius: "50%",
    background,
    flexShrink: 0,
  } as const;
}

/** Marks the rows of the entity tables that are shown in the viewer: a bar at their start (on the first cell, as
 * table rows draw no shadow). */
export function shownRowSx(shown: boolean) {
  return shown
    ? ({
        "& > td:first-of-type": {
          boxShadow: (theme: { palette: { primary: { main: string } } }) =>
            `inset 3px 0 0 ${theme.palette.primary.main}`,
        },
      } as const)
    : {};
}
