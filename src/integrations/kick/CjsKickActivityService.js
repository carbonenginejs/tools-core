import {
    LIVESTREAM_ACTIVITY_FAMILY,
    LIVESTREAM_ACTIVITY_TOPICS,
} from "../../realtime/livestream/CjsToolRealtimeLivestreamContract.js";
import { CjsToolWebhookProjectionService } from "../../webhook/CjsToolWebhookProjectionService.js";

/** Declares the live Kick activity projection over shared webhook ingress. */
export class CjsKickActivityService extends CjsToolWebhookProjectionService
{

    constructor({ id, source } = {})
    {
        super({
            id,
            source,
            family: LIVESTREAM_ACTIVITY_FAMILY,
            familyVersion: 1,
            kind: "kick.webhook",
            topics: Object.values(LIVESTREAM_ACTIVITY_TOPICS).map(name => ({
                name,
                recovery: "loss-tolerant",
            })),
        });
    }

}
