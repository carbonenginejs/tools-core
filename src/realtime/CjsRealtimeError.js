/** Stable protocol-facing error for realtime requests and transports. */
export class CjsRealtimeError extends Error
{

    constructor(code, message, {
        retryable = false,
        connectionUsable = true,
        statusCode = 400,
        closeCode = null,
        details = null,
        cause = undefined,
    } = {})
    {
        const safeCode = typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code)
            ? code
            : "internal_error";
        const safeMessage = String(message ?? "Realtime operation failed")
            .replace(/[\r\n]+/gu, " ")
            .slice(0, 256);

        super(safeMessage, { cause });
        this.name = "CjsRealtimeError";
        this.code = safeCode;
        this.retryable = retryable;
        this.connectionUsable = connectionUsable;
        this.statusCode = Number.isSafeInteger(statusCode)
            && statusCode >= 400 && statusCode <= 599
            ? statusCode
            : 500;
        this.closeCode = closeCode === null || CjsRealtimeError.isValidCloseCode(closeCode)
            ? closeCode
            : 1011;
        this.details = details;
    }

    /** Returns the secret-free wire representation of the error. */
    ToMessage(requestId = undefined)
    {
        const message = {
            type: "error",
            code: this.code,
            message: this.message,
            retryable: this.retryable,
            connectionUsable: this.connectionUsable,
        };

        if (requestId !== undefined)
        {
            message.requestId = requestId;
        }

        if (this.details !== null)
        {
            const details = CjsRealtimeError.cloneDetails(this.details);

            if (details !== null)
            {
                message.details = details;
            }
        }

        return message;
    }

    /** Converts an unexpected failure to a stable internal protocol error. */
    static from(error)
    {
        if (error instanceof CjsRealtimeError)
        {
            return error;
        }

        return new CjsRealtimeError("internal_error", "Realtime operation failed", {
            connectionUsable: true,
            statusCode: 500,
            cause: error,
        });
    }

    /** Returns a bounded JSON clone or null for unsafe error details. */
    static cloneDetails(value)
    {
        try
        {
            const text = JSON.stringify(value);

            if (text === undefined || new TextEncoder().encode(text).byteLength > 8192)
            {
                return null;
            }

            return JSON.parse(text);
        }
        catch
        {
            return null;
        }
    }

    /** Returns true for a usable standard or private WebSocket close code. */
    static isValidCloseCode(value)
    {
        return Number.isSafeInteger(value)
            && ((value >= 1000 && value <= 1014 && ![ 1004, 1005, 1006 ].includes(value))
                || (value >= 3000 && value <= 4999));
    }

}
