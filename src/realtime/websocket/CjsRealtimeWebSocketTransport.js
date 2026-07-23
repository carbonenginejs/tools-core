import { WebSocket } from "ws";

/** Adapts one ws socket to the transport-neutral connection contract. */
export class CjsRealtimeWebSocketTransport
{

    #socket;

    constructor({ socket, maxBufferedBytes })
    {
        if (!socket || typeof socket.send !== "function" || typeof socket.close !== "function")
        {
            throw new TypeError("Realtime WebSocket transport requires a ws-compatible socket");
        }

        if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes < 1)
        {
            throw new TypeError("Realtime WebSocket maxBufferedBytes must be positive");
        }

        this.#socket = socket;
        this.maxBufferedBytes = maxBufferedBytes;
        Object.freeze(this);
    }

    /** Sends one complete application text message. */
    Send(text)
    {
        if (this.#socket.readyState !== WebSocket.OPEN)
        {
            return Promise.reject(new Error("Realtime WebSocket is not open"));
        }

        if (this.#socket.bufferedAmount + Buffer.byteLength(text) > this.maxBufferedBytes)
        {
            this.#socket.close(4409, "resync_required");

            return Promise.reject(new Error("Realtime WebSocket consumer is too slow"));
        }

        return new Promise((resolve, reject) =>
        {
            this.#socket.send(text, error =>
            {
                if (error)
                {
                    reject(error);
                }
                else
                {
                    resolve();
                }
            });
        });
    }

    /** Closes the WebSocket with a stable secret-free reason. */
    Close(code, reason)
    {
        if ([ WebSocket.OPEN, WebSocket.CONNECTING ].includes(this.#socket.readyState))
        {
            this.#socket.close(code, String(reason).slice(0, 123));
        }
    }

}
