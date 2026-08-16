/** Vite resolves imported WebAssembly files to served asset URLs. */
declare module "*.wasm?url" {
  const url: string;
  export default url;
}
