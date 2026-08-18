Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { hardwareConcurrency: 1 },
});

// webgpu-utils references this constructor while its module is initialized.
// Node 20 and 22 do not provide it, and these reader tests do not exercise
// half-float GPU buffers, so a distinct typed-array stand-in is sufficient.
if (!("Float16Array" in globalThis)) {
  class Float16ArrayShim extends Uint16Array {}
  Object.defineProperty(globalThis, "Float16Array", {
    configurable: true,
    value: Float16ArrayShim,
  });
}
