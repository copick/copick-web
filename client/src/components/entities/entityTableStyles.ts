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
