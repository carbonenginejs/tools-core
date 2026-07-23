import { CjsKickActivityService } from "./CjsKickActivityService.js";
import { CjsKickStateService } from "./CjsKickStateService.js";
import {
    CjsKickWebhookHandler,
    KICK_WEBHOOK_PUBLIC_KEY,
} from "./CjsKickWebhookHandler.js";

export { KICK_WEBHOOK_PUBLIC_KEY };

/** Public live Kick activity service over shared webhook ingress. */
export class KickActivityService extends CjsKickActivityService
{
}

/** Public snapshot-backed Kick stream state service. */
export class KickStateService extends CjsKickStateService
{
}

/** Public official-signature Kick webhook normalizer. */
export class KickWebhookHandler extends CjsKickWebhookHandler
{
}
