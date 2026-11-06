/**
 * Last-resort crash handling: log the fatal error and exit non-zero within a second, so the
 * supervisor (or Task Scheduler / launchd / systemd for the supervisor itself) restarts us
 * instead of leaving a half-dead process that holds its ports but serves nothing.
 */
export function installFatalHandlers(source) {
    const onFatal = (err) => {
        try {
            console.error(`[${source}] fatal, exiting:`, err);
        }
        catch {
            /* stderr itself is broken: exit anyway */
        }
        // A listening server keeps the event loop alive forever, so force the exit after a short
        // grace period for the log line above to flush.
        setTimeout(() => process.exit(1), 500);
    };
    process.on("uncaughtException", onFatal);
    process.on("unhandledRejection", onFatal);
    return () => {
        process.removeListener("uncaughtException", onFatal);
        process.removeListener("unhandledRejection", onFatal);
    };
}
