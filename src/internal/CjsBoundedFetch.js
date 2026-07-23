/** Stable internal failure emitted by the bounded network boundary. */
export class CjsBoundedFetchError extends Error
{

    constructor(code, message, { cause = undefined } = {})
    {
        super(message, { cause });
        this.name = "CjsBoundedFetchError";
        this.code = code;
    }

}

/** Shared deadlines, cancellation, and streaming response limits for remote reads. */
export class CjsBoundedFetch
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

        const timeout = CjsBoundedFetch.normalizeLimit(timeoutMs, "timeoutMs");

        if (signal !== undefined && !(signal instanceof AbortSignal))
        {
            throw new TypeError("Bounded fetch signal must be an AbortSignal");
        }

        if (signal?.aborted)
        {
            throw new CjsBoundedFetchError(
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
        const onAbort = () => reject(new CjsBoundedFetchError(
            "request_aborted",
            `${label} was cancelled`,
            { cause: signal.reason },
        ));
        const timer = setTimeout(() => reject(new CjsBoundedFetchError(
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

        return CjsBoundedFetch.run(async boundedSignal =>
        {
            const response = await fetchImplementation(url, {
                ...options,
                signal: boundedSignal,
            });

            if (!response || typeof response !== "object")
            {
                throw new CjsBoundedFetchError(
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
        const maximum = CjsBoundedFetch.normalizeLimit(maxBytes, "maxBytes");

        if (timeoutMs !== undefined)
        {
            return CjsBoundedFetch.run(
                boundedSignal => CjsBoundedFetch.readBytesBody(
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

        return CjsBoundedFetch.readBytesBody(response, maximum, label, signal);
    }

    static async readBytesBody(response, maximum, label, signal)
    {
        CjsBoundedFetch.requireActive(signal, `${label} body`);
        const contentLength = CjsBoundedFetch.contentLength(response);

        if (contentLength !== null && contentLength > maximum)
        {
            throw CjsBoundedFetch.responseTooLarge(label, maximum);
        }

        if (typeof response?.body?.getReader === "function")
        {
            return CjsBoundedFetch.readWebStream(response.body, maximum, label, signal);
        }

        if (response?.body?.[Symbol.asyncIterator])
        {
            return CjsBoundedFetch.readAsyncIterable(response.body, maximum, label, signal);
        }

        if (typeof response?.arrayBuffer === "function")
        {
            const bytes = Buffer.from(await response.arrayBuffer());

            CjsBoundedFetch.requireActive(signal, `${label} body`);
            CjsBoundedFetch.requireByteLength(bytes.byteLength, maximum, label);

            return bytes;
        }

        throw new CjsBoundedFetchError(
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
            return CjsBoundedFetch.run(
                boundedSignal => CjsBoundedFetch.readJson(response, {
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
            const bytes = await CjsBoundedFetch.readBytes(response, {
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
                throw new CjsBoundedFetchError(
                    "invalid_response",
                    `${label} is not valid JSON`,
                    { cause: error },
                );
            }
        }

        if (typeof response?.json === "function")
        {
            CjsBoundedFetch.requireActive(signal, `${label} body`);
            const value = await response.json();
            let bytes;

            CjsBoundedFetch.requireActive(signal, `${label} body`);

            try
            {
                bytes = Buffer.byteLength(JSON.stringify(value));
            }
            catch (error)
            {
                throw new CjsBoundedFetchError(
                    "invalid_response",
                    `${label} is not JSON-compatible`,
                    { cause: error },
                );
            }

            CjsBoundedFetch.requireByteLength(
                Math.max(bytes, CjsBoundedFetch.contentLength(response) ?? 0),
                CjsBoundedFetch.normalizeLimit(maxBytes, "maxBytes"),
                label,
            );

            return value;
        }

        throw new CjsBoundedFetchError(
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
                : new CjsBoundedFetchError("request_aborted", `${label} was cancelled`);
        }
    }

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
                CjsBoundedFetch.requireActive(signal, `${label} body`);
                const { done, value } = await reader.read();

                if (done)
                {
                    break;
                }

                const chunk = CjsBoundedFetch.toBuffer(value, label);

                byteLength += chunk.byteLength;
                CjsBoundedFetch.requireByteLength(byteLength, maximum, label);
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
                CjsBoundedFetch.requireActive(signal, `${label} body`);
                const chunk = CjsBoundedFetch.toBuffer(value, label);

                byteLength += chunk.byteLength;
                CjsBoundedFetch.requireByteLength(byteLength, maximum, label);
                chunks.push(chunk);
            }
        }
        finally
        {
            signal?.removeEventListener("abort", onAbort);
        }

        return Buffer.concat(chunks, byteLength);
    }

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
            throw new CjsBoundedFetchError(
                "invalid_response",
                "Remote response has an invalid content length",
            );
        }

        return value;
    }

    static requireByteLength(byteLength, maximum, label)
    {
        if (byteLength > maximum)
        {
            throw CjsBoundedFetch.responseTooLarge(label, maximum);
        }
    }

    static responseTooLarge(label, maximum)
    {
        return new CjsBoundedFetchError(
            "response_too_large",
            `${label} exceeds its ${maximum}-byte limit`,
        );
    }

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

        throw new CjsBoundedFetchError(
            "invalid_response",
            `${label} returned a non-byte body chunk`,
        );
    }

    static normalizeLimit(value, label)
    {
        if (!Number.isSafeInteger(value) || value < 1)
        {
            throw new TypeError(`Bounded fetch ${label} must be a positive integer`);
        }

        return value;
    }

}
