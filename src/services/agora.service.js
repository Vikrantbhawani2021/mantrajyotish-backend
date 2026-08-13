const { RtcTokenBuilder, RtcRole } = require("agora-token");

/**
 * Generate Agora RTC Token for Video Session Channel
 * @param {string} channelName - Unique Channel/Room Name (e.g. room_123)
 * @param {number|string} uid - User ID (0 for auto-assign)
 * @param {string} role - "publisher" or "subscriber"
 * @param {number} expireTimeInSeconds - Token validity duration in seconds (default 3600 = 1 hr)
 */
const generateRtcToken = (channelName, uid = 0, role = "publisher", expireTimeInSeconds = 3600) => {
    const appId = process.env.AGORA_APP_ID || "af89ac0f87f4412ea75f23aba4717e04";
    const appCertificate = process.env.AGORA_APP_CERTIFICATE || "";

    if (!channelName) {
        throw new Error("Channel name is required for Agora token generation");
    }

    const numericUid = Number(uid) || 0;
    const rtcRole = role === "subscriber" ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expireTimeInSeconds;

    // If App Certificate is provided, generate real signed token
    if (appCertificate && appId !== "MOCK_AGORA_APP_ID") {
        const token = RtcTokenBuilder.buildTokenWithUid(
            appId,
            appCertificate,
            channelName,
            numericUid,
            rtcRole,
            privilegeExpiredTs,
            privilegeExpiredTs
        );

        return {
            token,
            appId,
            channelName,
            uid: numericUid,
            expiresAt: privilegeExpiredTs,
            isMock: false
        };
    }

    // Mock Token for development/testing when Agora credentials are not yet set
    return {
        token: `mock_agora_rtc_token_${channelName}_${numericUid}_${Date.now()}`,
        appId,
        channelName,
        uid: numericUid,
        expiresAt: privilegeExpiredTs,
        isMock: true,
        note: "Set AGORA_APP_ID and AGORA_APP_CERTIFICATE in .env for production tokens"
    };
};

module.exports = {
    generateRtcToken
};
