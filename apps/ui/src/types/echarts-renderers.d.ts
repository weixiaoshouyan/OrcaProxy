/**
 * Ambient types for echarts/renderers — echarts 6 ships renderers.js without
 * a root-level .d.ts (types/dist/renderers.d.ts is absent in the installed
 * package), so TS falls back to implicit any. Declare the two renderers we
 * use; method syntax keeps them structurally assignable to echarts' `use()`
 * EChartsExtension type (install: (ec) => void).
 */
declare module 'echarts/renderers' {
  export const CanvasRenderer: {
    install(ec: unknown): void;
    constructor: Function;
  };
  export const SVGRenderer: {
    install(ec: unknown): void;
    constructor: Function;
  };
}
