const Astrologer = require("../models/astro.model");
const { getPresence, transitionStatus } = require("./presence.service");

let workerInterval = null;

/**
 * Scan active chat and call sessions and auto-end them if astrologer is offline
 */
const checkOrphanedSessions = async () => {
    try {
        const mongoose = require("mongoose");
        if (mongoose.connection.readyState !== 1) {
            return;
        }
        const ChatSession = require("../models/chatSession.model");
        const VideoSession = require("../models/videoSession.model");
        const { endChatSession, stopBillingTimer } = require("./chatBilling.service");
        const { endCallSession } = require("./videoSession.service");
        const { stopCallBillingTimer } = require("./callBilling.service");
        const { getPresence } = require("./presence.service");
        const { getRedisClient } = require("../config/redis");
        
        const redisClient = getRedisClient();
        if (!redisClient || !redisClient.isOpen) return;

        const now = Date.now();

        // Scan for active chat sessions
        const activeChats = await ChatSession.find({ status: "ACTIVE" });
        for (const session of activeChats) {
            const presence = await getPresence(session.astrologer);
            const sessionStart = session.startTime ? new Date(session.startTime).getTime() : now;
            // Only auto-end if the session has been active for at least 45 seconds to avoid initial sync race conditions
            if (now - sessionStart > 45000) {
                // Safeguard: verify if the astrologer is offline in the DB first before terminating their active session
                const astroRecord = await Astrologer.findById(session.astrologer).lean().catch(() => null);
                const isOfflineInDb = !astroRecord || astroRecord.isOnline === false;
                
                if (isOfflineInDb && (!presence || (presence.connections === 0 && presence.status === "OFFLINE" && (now - presence.timestamp > 30000)))) {
                    console.log(`🧹 Presence worker: Auto-ending orphaned active chat session ${session._id} (astrologer offline)`);
                    stopBillingTimer(session._id);
                    await endChatSession(session._id).catch(err => console.error("Error ending orphaned chat:", err.message));
                }
            }
        }

        // Scan for active call sessions
        const activeCalls = await VideoSession.find({ status: { $in: ["ACTIVE", "live"] } });
        for (const session of activeCalls) {
            const presence = await getPresence(session.astrologer);
            const sessionStart = session.startTime ? new Date(session.startTime).getTime() : now;
            // Only auto-end if the session has been active for at least 45 seconds to avoid initial sync race conditions
            if (now - sessionStart > 45000) {
                // Safeguard: verify if the astrologer is offline in the DB first before terminating their active session
                const astroRecord = await Astrologer.findById(session.astrologer).lean().catch(() => null);
                const isOfflineInDb = !astroRecord || astroRecord.isOnline === false;

                if (isOfflineInDb && (!presence || (presence.connections === 0 && presence.status === "OFFLINE" && (now - presence.timestamp > 30000)))) {
                    console.log(`🧹 Presence worker: Auto-ending orphaned active call session ${session._id} (astrologer offline)`);
                    stopCallBillingTimer(session._id);
                    await endCallSession(session._id).catch(err => console.error("Error ending orphaned call:", err.message));
                }
            }
        }
    } catch (err) {
        console.error("Presence worker: checkOrphanedSessions error:", err.message);
    }
};

/**
 * Scan online astrologers in MongoDB and transition them offline if Redis presence has expired
 */
const checkOnlineAstrologersPresence = async () => {
    try {
        const mongoose = require("mongoose");
        if (mongoose.connection.readyState !== 1) {
            return;
        }
        const { getRedisClient } = require("../config/redis");
        const redisClient = getRedisClient();
        if (!redisClient || !redisClient.isOpen) {
            // Redis is down or not connected, skip presence checks to avoid setting everyone offline
            return;
        }

        // 1. Reconcile orphaned chat/call sessions
        await checkOrphanedSessions();

        const onlineAstrologers = await Astrologer.find({
            status: "approved",
            isOnline: true
        }).lean();

        for (const astro of onlineAstrologers) {
            const presence = await getPresence(astro._id);

            // If no active presence is found in Redis, the astrologer's heartbeat/session expired
            if (!presence) {
                const ChatSession = require("../models/chatSession.model");
                const VideoSession = require("../models/videoSession.model");

                // Check if they are currently in an active session (chat or call)
                const activeChat = await ChatSession.findOne({ astrologer: astro._id, status: "ACTIVE" }).lean().catch(() => null);
                const activeCall = await VideoSession.findOne({ astrologer: astro._id, status: { $in: ["ACTIVE", "live"] } }).lean().catch(() => null);
                
                if (activeChat || activeCall) {
                    console.log(`ℹ️ Heartbeat missed for Astrologer ${astro.name} (${astro._id}) but they are in an active session. Skipping transition to OFFLINE.`);
                    // Eagerly restore/re-write presence key to Redis so it doesn't stay null
                    const { setPresence } = require("./presence.service");
                    await setPresence(astro._id, {
                        status: "BUSY",
                        connections: 1,
                        lastHeartbeat: Date.now(),
                        activeSessionId: String(activeChat ? activeChat._id : activeCall._id),
                        timestamp: Date.now(),
                        version: 1
                    }).catch(() => null);
                    continue;
                }

                console.log(`⚠️ Heartbeat missed or Redis key expired for Astrologer ${astro.name} (${astro._id}). Transitioning to OFFLINE.`);
                await transitionStatus(astro._id, "OFFLINE").catch(err => {
                    console.error(`Failed to automatically transition astro ${astro._id} offline:`, err.message);
                });
            }
        }
    } catch (err) {
        console.error("Presence check worker encountered an error:", err);
    }
};

/**
 * Start the periodic presence checker worker
 */
const startPresenceWorker = (intervalSeconds = 15) => {
    if (workerInterval) {
        clearInterval(workerInterval);
    }

    console.log(`⏱️ Presence verification background worker started (Interval: ${intervalSeconds}s)`);
    workerInterval = setInterval(checkOnlineAstrologersPresence, intervalSeconds * 1000);
};

/**
 * Stop the worker
 */
const stopPresenceWorker = () => {
    if (workerInterval) {
        clearInterval(workerInterval);
        workerInterval = null;
        console.log("⏱️ Presence verification background worker stopped.");
    }
};

module.exports = {
    startPresenceWorker,
    stopPresenceWorker,
    checkOnlineAstrologersPresence
};
