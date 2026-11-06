/** Small glob -> RegExp (case-insensitive): `*`, `?`, `[...]`, and `**` when the pattern contains a slash. */
export function globToRegex(pattern) {
    const p = pattern.replace(/\\/g, "/");
    let re = "";
    for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === "*") {
            if (p[i + 1] === "*") {
                i++;
                if (p[i + 1] === "/") {
                    i++;
                    re += "(?:.*/)?";
                }
                else
                    re += ".*";
            }
            else
                re += "[^/]*";
        }
        else if (c === "?")
            re += "[^/]";
        else if (c === "[") {
            const end = p.indexOf("]", i + 1);
            if (end < 0)
                re += "\\[";
            else {
                let body = p.slice(i + 1, end);
                if (body.startsWith("!"))
                    body = "^" + body.slice(1);
                re += `[${body.replace(/\\/g, "\\\\")}]`;
                i = end;
            }
        }
        else
            re += c.replace(/[.+^${}()|\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`, "i");
}
/** Match a name (or, if the pattern has a slash, a relative posix path). */
export function globMatcher(pattern) {
    const re = globToRegex(pattern);
    const useRel = /[\\/]/.test(pattern);
    return (name, rel) => re.test(useRel ? rel : name);
}
