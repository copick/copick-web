/**
 * Form state of the object types dialog: conversion from and to the API's
 * object type fields, and the same checks the server (and the desktop Edit
 * Object Types dialog) applies, so problems show up while typing.
 */

import type { ObjectTypeFields, Rgba } from "@/api/types";
import { instanceRgb } from "./instanceColors";
import { validateCopickName } from "./validation";

export type Polarity = "unknown" | "polar" | "apolar";

export interface ObjectTypeForm {
  name: string;
  /** Text inputs keep what the user typed; they are parsed on save. */
  label: string;
  /** "#rrggbb" */
  colorHex: string;
  /** 0-255 */
  alpha: number;
  isParticle: boolean;
  isFilament: boolean;
  polarity: Polarity;
  rise: string;
  twist: string;
  radius: string;
  mapThreshold: string;
  emdbId: string;
  pdbId: string;
  identifier: string;
}

export type FormErrors = Partial<Record<keyof ObjectTypeForm, string>>;

const hex2 = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, "0");

export function toHex([r, g, b]: Rgba | [number, number, number]): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function fromHex(hex: string, alpha: number): Rgba {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128, alpha];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), alpha];
}

const text = (v: number | string | null | undefined) =>
  v === null || v === undefined ? "" : String(v);

/** A new object: the next free label and a colour that differs from its neighbours'. */
export function emptyForm(
  suggestedLabel: number,
  objectCount: number,
): ObjectTypeForm {
  const [r, g, b] = instanceRgb(objectCount + 1);
  return {
    name: "",
    label: String(suggestedLabel),
    colorHex: toHex([r * 255, g * 255, b * 255]),
    alpha: 255,
    isParticle: true,
    isFilament: false,
    polarity: "unknown",
    rise: "",
    twist: "",
    radius: "",
    mapThreshold: "",
    emdbId: "",
    pdbId: "",
    identifier: "",
  };
}

export function formFromObject(obj: ObjectTypeFields): ObjectTypeForm {
  const f = obj.filament;
  return {
    name: obj.name,
    label: text(obj.label),
    colorHex: toHex(obj.color),
    alpha: obj.color[3] ?? 255,
    isParticle: obj.is_particle,
    isFilament: f !== null,
    polarity:
      f?.polar === true ? "polar" : f?.polar === false ? "apolar" : "unknown",
    rise: text(f?.helical_rise_a),
    twist: text(f?.helical_twist_deg),
    radius: text(obj.radius),
    mapThreshold: text(obj.map_threshold),
    emdbId: text(obj.emdb_id),
    pdbId: text(obj.pdb_id),
    identifier: text(obj.identifier),
  };
}

const number = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

const optional = (v: string) => v.trim() || null;

export function fieldsFromForm(form: ObjectTypeForm): ObjectTypeFields {
  return {
    name: form.name.trim(),
    is_particle: form.isParticle,
    label: number(form.label),
    color: fromHex(form.colorHex, form.alpha),
    radius: number(form.radius),
    map_threshold: number(form.mapThreshold),
    emdb_id: optional(form.emdbId),
    pdb_id: optional(form.pdbId),
    identifier: optional(form.identifier),
    filament:
      form.isParticle && form.isFilament
        ? {
            polar:
              form.polarity === "polar"
                ? true
                : form.polarity === "apolar"
                  ? false
                  : null,
            helical_rise_a: number(form.rise),
            helical_twist_deg: number(form.twist),
          }
        : null,
  };
}

/**
 * Problems with the form, by field; empty when it can be saved.
 *
 * @param others - The other object types (not the one being edited).
 */
export function validateForm(
  form: ObjectTypeForm,
  others: Pick<ObjectTypeFields, "name" | "label">[],
): FormErrors {
  const errors: FormErrors = {};
  const name = form.name.trim();
  const nameCheck = validateCopickName(name);
  if (!nameCheck.isValid) errors.name = nameCheck.errorMessage;
  else if (others.some((o) => o.name.toLowerCase() === name.toLowerCase()))
    errors.name = `An object named '${name}' already exists.`;

  const label = number(form.label);
  if (
    label === null ||
    Number.isNaN(label) ||
    !Number.isInteger(label) ||
    label < 1
  )
    errors.label = "A whole number of at least 1 (0 is the background).";
  else if (others.some((o) => o.label === label))
    errors.label = `Label ${label} is already used by another object.`;

  const radius = number(form.radius);
  if (radius !== null && !(radius > 0))
    errors.radius = "A positive number, or empty.";
  if (Number.isNaN(number(form.mapThreshold)))
    errors.mapThreshold = "A number, or empty.";
  if (form.isParticle && form.isFilament) {
    const rise = number(form.rise);
    if (rise !== null && !(rise > 0))
      errors.rise = "A positive number, or empty.";
    if (Number.isNaN(number(form.twist))) errors.twist = "A number, or empty.";
  }
  return errors;
}
