import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/**
 * The one place the version comes from: package.json. Nothing else hardcodes it, so `npm run release` is enough to
 * change what the server, the User-Agent, the health endpoint and the dashboard report.
 * Works from src/core/ (tsx, vitest) and dist/core/ because package.json is two levels above both.
 */
export const VERSION = (() => {
    try {
        const here = path.dirname(fileURLToPath(import.meta.url));
        return JSON.parse(fs.readFileSync(path.join(here, "..", "..", "package.json"), "utf8")).version;
    }
    catch {
        return "0.0.0-unknown";
    }
})();
