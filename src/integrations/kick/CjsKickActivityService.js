import {
    LIVESTREAM_ACTIVITY_FAMILY,
    LIVESTREAM_ACTIVITY_TOPICS,
} from "../../realtime/livestream/CjsRealtimeLivestreamContract.js";
import { CjsWebhookProjectionService } from "../../webhook/CjsWebhookProjectionService.js";

/** Declares the live Kick activity projection over shared webhook ingress. */
export class CjsKickActivityService extends CjsWebhookProjectionService
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
