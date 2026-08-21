const Astrologer = require("../models/astro.model");
const { getPresence, transitionStatus } = require("./presence.service");

let workerInterval = null;

/**
 * Scan online astrologers in MongoDB and transition them offline if Redis presence has expired
 */
const checkOnlineAstrologersPresence = async () => {
    try {
        const { getRedisClient } = require("../config/redis");
        const redisClient = getRedisClient();
        if (!redisClient || !redisClient.isOpen) {
            // Redis is down or not connected, skip presence checks to avoid setting everyone offline
            return;
        }

        const onlineAstrologers = await Astrologer.find({
            status: "approved",
            isOnline: true
        }).lean();

        for (const astro of onlineAstrologers) {
            const presence = await getPresence(astro._id);

            // If no active presence is found in Redis, the astrologer's heartbeat/session expired
            if (!presence) {
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
