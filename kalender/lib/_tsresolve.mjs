// Test-only loader. App source imports siblings extensionlessly (e.g. `./db`)
// to match the Next.js/Turbopack convention. Node's native test runner / type
// stripping requires explicit extensions, so this resolve hook appends `.ts`
// for relative specifiers that lack one. Used via:
//   node --import ./lib/_tsresolve.mjs --test lib/<name>.test.ts
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.(ts|mts|cts|js|mjs|cjs|json)$/.test(specifier)) {
      try {
        return nextResolve(specifier + ".ts", context);
      } catch {
        // fall through to default resolution below
      }
    }
    return nextResolve(specifier, context);
  },
});
