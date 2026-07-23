/** Stable HTTP-facing failure raised by webhook endpoints and processors. */
export class CjsWebhookError extends Error
{

    constructor(code, message, {
        retryable = false,
        statusCode = 400,
        cause = undefined,
    } = {})
    {
        const safeCode = typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code)
            ? code
            : "internal_error";
        const safeMessage = String(message ?? "Webhook operation failed")
            .replace(/[\r\n]+/gu, " ")
            .slice(0, 256);

        super(safeMessage, { cause });
        this.name = "CjsWebhookError";
        this.code = safeCode;
        this.retryable = retryable === true;
        this.statusCode = Number.isSafeInteger(statusCode)
            && statusCode >= 400 && statusCode <= 599
            ? statusCode
            : 500;
    }

    /** Converts an unexpected failure to a secret-free webhook error. */
    static from(error)
    {
        if (error instanceof CjsWebhookError)
        {
            return error;
        }

        return new CjsWebhookError("internal_error", "Webhook operation failed", {
            statusCode: 500,
            cause: error,
        });
    }

}
