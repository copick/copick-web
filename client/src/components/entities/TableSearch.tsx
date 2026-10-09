/**
 * Search field of the entity tables: filters rows as you type (Escape clears)
 * and shows how many rows match.
 */

import {
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";
import { Clear as ClearIcon, Search as SearchIcon } from "@mui/icons-material";

interface TableSearchProps {
  value: string;
  onChange: (value: string) => void;
  /** What is searched, e.g. "picks". */
  what: string;
  shown: number;
  total: number;
}

export function TableSearch({
  value,
  onChange,
  what,
  shown,
  total,
}: TableSearchProps) {
  return (
    <TextField
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") onChange("");
      }}
      placeholder={`Search ${what}…`}
      inputProps={{ "aria-label": `Search ${what}` }}
      sx={{ flexGrow: 1, minWidth: 0, "& .MuiInputBase-input": { py: 0.5 } }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon fontSize="small" />
          </InputAdornment>
        ),
        endAdornment: value ? (
          <InputAdornment position="end">
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mr: 0.5 }}
            >
              {shown}/{total}
            </Typography>
            <IconButton
              size="small"
              aria-label="Clear search"
              onClick={() => onChange("")}
              edge="end"
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          </InputAdornment>
        ) : undefined,
      }}
    />
  );
}
