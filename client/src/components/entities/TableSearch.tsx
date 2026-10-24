/**
 * Search field of the entity tables: filters rows as you type (Escape clears)
 * and shows how many rows match. With `onShownOnlyChange`, an eye toggle next
 * to it limits the table to the rows shown in the viewer (with their count).
 */

import {
  Badge,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Clear as ClearIcon,
  Search as SearchIcon,
  Visibility as ShownIcon,
} from "@mui/icons-material";

interface TableSearchProps {
  value: string;
  onChange: (value: string) => void;
  /** What is searched, e.g. "picks". */
  what: string;
  shown: number;
  total: number;
  /** Show only the rows shown in the viewer. */
  shownOnly?: boolean;
  onShownOnlyChange?: (value: boolean) => void;
  /** How many rows are shown in the viewer. */
  displayed?: number;
}

export function TableSearch({
  value,
  onChange,
  what,
  shown,
  total,
  shownOnly = false,
  onShownOnlyChange,
  displayed = 0,
}: TableSearchProps) {
  const filtered = !!value || shownOnly;
  return (
    <>
      <TextField
        size="small"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
        placeholder={`Search ${what}…`}
        sx={{ flexGrow: 1, minWidth: 0, "& .MuiInputBase-input": { py: 0.5 } }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: filtered ? (
              <InputAdornment position="end">
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.secondary",
                    mr: 0.5,
                  }}
                >
                  {shown}/{total}
                </Typography>
                {value && (
                  <IconButton
                    size="small"
                    aria-label="Clear search"
                    onClick={() => onChange("")}
                    edge="end"
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                )}
              </InputAdornment>
            ) : undefined,
          },

          htmlInput: { "aria-label": `Search ${what}` },
        }}
      />
      {onShownOnlyChange && (
        <Tooltip
          title={
            shownOnly
              ? `Showing only the ${what} shown in the viewer: click to list all`
              : `List only the ${what} shown in the viewer (${displayed})`
          }
        >
          <IconButton
            size="small"
            aria-label={`Only shown ${what}`}
            aria-pressed={shownOnly}
            color={shownOnly ? "primary" : "default"}
            onClick={() => onShownOnlyChange(!shownOnly)}
            sx={{ ml: 0.5, flexShrink: 0 }}
          >
            <Badge
              badgeContent={displayed}
              color="primary"
              max={99}
              sx={{
                "& .MuiBadge-badge": { fontSize: 10, height: 16, minWidth: 16 },
              }}
            >
              <ShownIcon fontSize="small" />
            </Badge>
          </IconButton>
        </Tooltip>
      )}
    </>
  );
}
