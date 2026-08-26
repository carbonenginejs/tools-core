/** Stable internal failure emitted by the bounded network boundary. */
export class CjsToolBoundedFetchError extends Error
{

    /**
     * Creates a coded transport failure while retaining an optional underlying
     * cause.
     */
    constructor(code, message, { cause = undefined } = {})
    {
        super(message, { cause });
        this.name = "CjsToolBoundedFetchError";
        this.code = code;
    }

}

/** Shared deadlines, cancellation, and streaming response limits for remote reads. */
export class CjsToolBoundedFetch
{

    /** Runs asynchronous work behind a hard deadline and composed caller cancellation. */
    static async run(callback, {
        timeoutMs,
        signal = undefined,
        label = "Remote request",
    } = {})
    {
        if (typeof callback !== "function")
        {
            throw new TypeError("Bounded fetch callback must be a function");
        }

        const timeout = CjsToolBoundedFetch.normalizeLimit(timeoutMs, "timeoutMs");

        if (signal !== undefined && !(signal instanceof AbortSignal))
        {
            throw new TypeError("Bounded fetch signal must be an AbortSignal");
        }

        if (signal?.aborted)
        {
            throw new CjsToolBoundedFetchError(
                "request_aborted",
                `${label} was cancelled`,
                { cause: signal.reason },
            );
        }

        const controller = new AbortController();
        let rejectBoundary;
        let settled = false;
        const boundary = new Promise((_resolve, reject) =>
        {
            rejectBoundary = reject;
        });
        const reject = error =>
        {
            if (settled)
            {
                return;
            }

            settled = true;
            rejectBoundary(error);
            controller.abort(error);
        };
        const onAbort = () => reject(new CjsToolBoundedFetchError(
            "request_aborted",
            `${label} was cancelled`,
            { cause: signal.reason },
        ));
        const timer = setTimeout(() => reject(new CjsToolBoundedFetchError(
            "request_timeout",
            `${label} timed out`,
        )), timeout);

        signal?.addEventListener("abort", onAbort, { once: true });

        try
        {
            return await Promise.race([
                Promise.resolve().then(() => callback(controller.signal)),
                boundary,
            ]);
        }
        finally
        {
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        }
    }

    /** Calls a Fetch-compatible adapter behind the shared deadline boundary. */
    static request(fetchImplementation, url, options = {}, limits = {})
    {
        if (typeof fetchImplementation !== "function")
        {
            throw new TypeError("Bounded fetch requires a Fetch-compatible function");
        }

        const signal = limits.signal ?? options.signal;

        return CjsToolBoundedFetch.run(async boundedSignal =>
        {
            const response = await fetchImplementation(url, {
                ...options,
                signal: boundedSignal,
            });

            if (!response || typeof response !== "object")
            {
                throw new CjsToolBoundedFetchError(
                    "invalid_response",
                    `${limits.label ?? "Remote request"} returned an invalid response`,
                );
            }

            return response;
        }, { ...limits, signal });
    }

    /** Reads one response body incrementally and fails before retaining excess bytes. */
    static async readBytes(response, {
        maxBytes,
        label = "Remote response",
        timeoutMs = undefined,
        signal = undefined,
    } = {})
    {
        const maximum = CjsToolBoundedFetch.normalizeLimit(maxBytes, "maxBytes");

        if (timeoutMs !== undefined)
        {
            return CjsToolBoundedFetch.run(
                boundedSignal => CjsToolBoundedFetch.readBytesBody(
                    response,
                    maximum,
                    label,
                    boundedSignal,
                ),
                {
                    timeoutMs,
                    signal,
                    label: `${label} body`,
                },
            );
        }

        if (signal !== undefined && !(signal instanceof AbortSignal))
        {
            throw new TypeError("Bounded response signal must be an AbortSignal");
        }

        return CjsToolBoundedFetch.readBytesBody(response, maximum, label, signal);
    }

    /**
     * Selects a supported response-body reader and enforces cancellation and
     * byte limits.
     */
    static async readBytesBody(response, maximum, label, signal)
    {
        CjsToolBoundedFetch.requireActive(signal, `${label} body`);
        const contentLength = CjsToolBoundedFetch.contentLength(response);

        if (contentLength !== null && contentLength > maximum)
        {
            throw CjsToolBoundedFetch.responseTooLarge(label, maximum);
        }

        if (typeof response?.body?.getReader === "function")
        {
            return CjsToolBoundedFetch.readWebStream(response.body, maximum, label, signal);
        }

        if (response?.body?.[Symbol.asyncIterator])
        {
            return CjsToolBoundedFetch.readAsyncIterable(response.body, maximum, label, signal);
        }

        if (typeof response?.arrayBuffer === "function")
        {
            const bytes = Buffer.from(await response.arrayBuffer());

            CjsToolBoundedFetch.requireActive(signal, `${label} body`);
            CjsToolBoundedFetch.requireByteLength(bytes.byteLength, maximum, label);

            return bytes;
        }

        throw new CjsToolBoundedFetchError(
            "invalid_response",
            `${label} does not provide a readable body`,
        );
    }

    /** Reads and parses bounded UTF-8 JSON, retaining compatibility with simple test adapters. */
    static async readJson(response, {
        maxBytes,
        label = "Remote JSON response",
        timeoutMs = undefined,
        signal = undefined,
    } = {})
    {
        if (timeoutMs !== undefined)
        {
            return CjsToolBoundedFetch.run(
                boundedSignal => CjsToolBoundedFetch.readJson(response, {
                    maxBytes,
                    label,
                    signal: boundedSignal,
                }),
                {
                    timeoutMs,
                    signal,
                    label: `${label} body`,
                },
            );
        }

        if (response?.body || typeof response?.arrayBuffer === "function")
        {
            const bytes = await CjsToolBoundedFetch.readBytes(response, {
                maxBytes,
                label,
                timeoutMs,
                signal,
            });

            try
            {
                return JSON.parse(bytes.toString("utf8"));
            }
            catch (error)
            {
                throw new CjsToolBoundedFetchError(
                    "invalid_response",
                    `${label} is not valid JSON`,
                    { cause: error },
                );
            }
        }

        if (typeof response?.json === "function")
        {
            CjsToolBoundedFetch.requireActive(signal, `${label} body`);
            const value = await response.json();
            let bytes;

            CjsToolBoundedFetch.requireActive(signal, `${label} body`);

            try
            {
                bytes = Buffer.byteLength(JSON.stringify(value));
            }
            catch (error)
            {
                throw new CjsToolBoundedFetchError(
                    "invalid_response",
                    `${label} is not JSON-compatible`,
                    { cause: error },
                );
            }

            CjsToolBoundedFetch.requireByteLength(
                Math.max(bytes, CjsToolBoundedFetch.contentLength(response) ?? 0),
                CjsToolBoundedFetch.normalizeLimit(maxBytes, "maxBytes"),
                label,
            );

            return value;
        }

        throw new CjsToolBoundedFetchError(
            "invalid_response",
            `${label} does not provide a readable body`,
        );
    }

    /** Throws before a timed-out operation can continue into another side effect. */
    static requireActive(signal, label = "Remote request")
    {
        if (signal?.aborted)
        {
            throw signal.reason instanceof Error
                ? signal.reason
                : new CjsToolBoundedFetchError("request_aborted", `${label} was cancelled`);
        }
    }

    /**
     * Consumes a Web readable stream into a bounded buffer and cancels it on
     * failure.
     */
    static async readWebStream(stream, maximum, label, signal)
    {
        const reader = stream.getReader();
        const chunks = [];
        let byteLength = 0;
        const onAbort = () =>
        {
            reader.cancel(signal.reason).catch(() => undefined);
        };

        signal?.addEventListener("abort", onAbort, { once: true });

        try
        {
            while (true)
            {
                CjsToolBoundedFetch.requireActive(signal, `${label} body`);
                const { done, value } = await reader.read();

                if (done)
                {
                    break;
                }

                const chunk = CjsToolBoundedFetch.toBuffer(value, label);

                byteLength += chunk.byteLength;
                CjsToolBoundedFetch.requireByteLength(byteLength, maximum, label);
                chunks.push(chunk);
            }
        }
        catch (error)
        {
            await reader.cancel(error).catch(() => undefined);
            throw error;
        }
        finally
        {
            signal?.removeEventListener("abort", onAbort);
            reader.releaseLock();
        }

        return Buffer.concat(chunks, byteLength);
    }

    /**
     * Consumes a Node-style async byte stream into a bounded buffer with abort
     * propagation.
     */
    static async readAsyncIterable(stream, maximum, label, signal)
    {
        const chunks = [];
        let byteLength = 0;
        const onAbort = () => stream.destroy?.(signal.reason);

        signal?.addEventListener("abort", onAbort, { once: true });

        try
        {
            for await (const value of stream)
            {
                CjsToolBoundedFetch.requireActive(signal, `${label} body`);
                const chunk = CjsToolBoundedFetch.toBuffer(value, label);

                byteLength += chunk.byteLength;
                CjsToolBoundedFetch.requireByteLength(byteLength, maximum, label);
                chunks.push(chunk);
            }
        }
        finally
        {
            signal?.removeEventListener("abort", onAbort);
        }

        return Buffer.concat(chunks, byteLength);
    }

    /**
     * Parses a non-negative safe content-length header or reports that none was
     * supplied.
     */
    static contentLength(response)
    {
        const source = typeof response?.headers?.get === "function"
            ? response.headers.get("content-length")
            : response?.headers?.["content-length"];

        if (source === undefined || source === null || source === "")
        {
            return null;
        }

        const value = Number(source);

        if (!Number.isSafeInteger(value) || value < 0)
        {
            throw new CjsToolBoundedFetchError(
                "invalid_response",
                "Remote response has an invalid content length",
            );
        }

        return value;
    }

    /** Rejects an accumulated response size that exceeds the configured maximum. */
    static requireByteLength(byteLength, maximum, label)
    {
        if (byteLength > maximum)
        {
            throw CjsToolBoundedFetch.responseTooLarge(label, maximum);
        }
    }

    /**
     * Constructs the stable coded error used when a remote body exceeds its
     * limit.
     */
    static responseTooLarge(label, maximum)
    {
        return new CjsToolBoundedFetchError(
            "response_too_large",
            `${label} exceeds its ${maximum}-byte limit`,
        );
    }

    /**
     * Converts byte buffers and typed-array views to a Node buffer without
     * accepting other chunks.
     */
    static toBuffer(value, label)
    {
        if (Buffer.isBuffer(value))
        {
            return value;
        }

        if (value instanceof ArrayBuffer)
        {
            return Buffer.from(value);
        }

        if (ArrayBuffer.isView(value))
        {
            return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        }

        throw new CjsToolBoundedFetchError(
            "invalid_response",
            `${label} returned a non-byte body chunk`,
        );
    }

    /** Validates a configured bound as a positive safe integer. */
    static normalizeLimit(value, label)
    {
        if (!Number.isSafeInteger(value) || value < 1)
        {
            throw new TypeError(`Bounded fetch ${label} must be a positive integer`);
        }

        return value;
    }

}
