import { describe, expect, test } from "vitest";
import {
  emptyForm,
  fieldsFromForm,
  formFromObject,
  fromHex,
  toHex,
  validateForm,
} from "./objectTypeForm";
import type { ObjectTypeFields } from "@/api/types";

const ribosome: ObjectTypeFields = {
  name: "ribosome",
  is_particle: true,
  label: 1,
  color: [255, 0, 0, 200],
  radius: 150,
  map_threshold: null,
  emdb_id: "EMD-1234",
  pdb_id: null,
  identifier: "GO:0005840",
  filament: null,
};

describe("object type form", () => {
  test("round-trips an object, including empty optional fields and alpha", () => {
    expect(fieldsFromForm(formFromObject(ribosome))).toEqual(ribosome);
  });

  test("filament fields round-trip and are dropped for non-particles", () => {
    const mt = {
      ...ribosome,
      name: "microtubule",
      filament: { polar: true, helical_rise_a: 9.4, helical_twist_deg: null },
    };
    expect(fieldsFromForm(formFromObject(mt)).filament).toEqual(mt.filament);
    const form = { ...formFromObject(mt), isParticle: false };
    expect(fieldsFromForm(form).filament).toBeNull();
  });

  test("hex colours", () => {
    expect(toHex([255, 16, 0, 255])).toBe("#ff1000");
    expect(fromHex("#ff1000", 128)).toEqual([255, 16, 0, 128]);
  });

  test("a new object gets the suggested label and a valid colour", () => {
    const form = emptyForm(7, 3);
    expect(form.label).toBe("7");
    expect(form.colorHex).toMatch(/^#[0-9a-f]{6}$/);
    expect(validateForm({ ...form, name: "proteasome" }, [ribosome])).toEqual(
      {},
    );
  });

  test("checks names, labels and numbers like the server", () => {
    const others = [ribosome];
    const base = { ...emptyForm(2, 1), name: "proteasome" };
    expect(
      validateForm({ ...base, name: "bad name" }, others).name,
    ).toBeTruthy();
    expect(validateForm({ ...base, name: "Ribosome" }, others).name).toMatch(
      /already exists/,
    );
    expect(validateForm({ ...base, label: "1" }, others).label).toMatch(
      /already used/,
    );
    expect(validateForm({ ...base, label: "0" }, others).label).toMatch(
      /at least 1/,
    );
    expect(validateForm({ ...base, label: "2.5" }, others).label).toBeTruthy();
    expect(validateForm({ ...base, radius: "-3" }, others).radius).toBeTruthy();
    expect(
      validateForm({ ...base, isFilament: true, rise: "0" }, others).rise,
    ).toBeTruthy();
    // editing an object: its own name and label are not conflicts
    expect(validateForm(formFromObject(ribosome), [])).toEqual({});
  });
});
