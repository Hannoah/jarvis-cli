import { getOrCreateApiKey, maskSecret } from "./security/auth.js";
import { loadConfig } from "./core/config.js";
import { createCtx } from "./core/context.js";
import { installFatalHandlers } from "./core/fatal.js";
installFatalHandlers("server");
import { enrichEnv } from "./system/cliEnv.js";
import { createHttpServer } from "./server/http.js";
import { appDir, prepareDataDir } from "./core/paths.js";
import { loadPlugins } from "./server/plugins.js";
import { VERSION } from "./core/version.js";
// The supervisor/installer pass JARVIS_HOME (the data folder); run directly, data goes to ~/.jarvis.
const { dataDir } = prepareDataDir();
const cfg = loadConfig({ projectDir: appDir, dataDir });
const ctx = createCtx(cfg);
Object.assign(process.env, enrichEnv(process.env, cfg.home)); // PATH/KUBECONFIG for run_terminal and the CLI tools
await loadPlugins(ctx);
const apiKey = getOrCreateApiKey(cfg);
// Bind loopback only: the Dev Tunnel connects locally, so nothing else needs to reach this port.
createHttpServer(ctx, apiKey).listen(cfg.port, "127.0.0.1", () => {
    console.log(`jarvis-ts v${VERSION} listening on http://127.0.0.1:${cfg.port}/mcp (api key ${maskSecret(apiKey)})`);
});
