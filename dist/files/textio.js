/** Text encoding helpers. Reads fall back to cp949 (Korean Windows files); writes are limited to Buffer encodings. */
const BUFFER_ENCODINGS = {
    "utf-8": "utf8",
    utf8: "utf8",
    "utf-16le": "utf16le",
    utf16le: "utf16le",
    latin1: "latin1",
    "iso-8859-1": "latin1",
    ascii: "ascii",
};
export function bufferEncoding(name) {
    return BUFFER_ENCODINGS[name.trim().toLowerCase()] ?? null;
}
/** Decode with the requested encoding; on failure retry as cp949. */
export function decodeText(buf, encoding = "utf-8") {
    const label = encoding.trim().toLowerCase() || "utf-8";
    try {
        return { text: new TextDecoder(label, { fatal: true }).decode(buf), encoding: label };
    }
    catch {
        try {
            return { text: new TextDecoder("euc-kr").decode(buf), encoding: "cp949" }; // WHATWG euc-kr == windows-949
        }
        catch (e) {
            throw new Error(`Failed to decode file: ${e.message}`);
        }
    }
}
/** Python's str.splitlines() for the common cases (\n, \r\n, \r), without a trailing empty line. */
export function splitLines(text) {
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length && lines[lines.length - 1] === "")
        lines.pop();
    return lines;
}
