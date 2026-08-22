const { getRedisClient } = require("../config/redis");
const Astrologer = require("../models/astro.model");

const PRESENCE_PREFIX = "astrologer:presence:";
const LOCK_PREFIX = "lock:astrologer:booking:";
const DEFAULT_TTL = parseInt(process.env.PRESENCE_TTL) || 30;

/**
 * Fetch current presence data from Redis
 */
const getPresence = async (astrologerId) => {
    try {
        const client = getRedisClient();
        if (!client || !client.isOpen) return null;

        const key = `${PRESENCE_PREFIX}${astrologerId}`;
        const data = await client.hGetAll(key);

        if (!data || Object.keys(data).length === 0) {
            return null;
        }

        return {
            status: data.status,
            connections: parseInt(data.connections) || 0,
            lastHeartbeat: parseInt(data.lastHeartbeat) || 0,
            activeSessionId: data.activeSessionId || null,
            timestamp: parseInt(data.timestamp) || 0,
            version: parseInt(data.version) || 0
        };
    } catch (err) {
        console.error(`Error getting presence for astro ${astrologerId}:`, err);
        return null;
    }
};

/**
 * Eagerly save presence to Redis with TTL
 */
const setPresence = async (astrologerId, data) => {
    try {
        const client = getRedisClient();
        if (!client || !client.isOpen) return false;

        const key = `${PRESENCE_PREFIX}${astrologerId}`;
        
        const redisPayload = {
            status: String(data.status),
            connections: String(data.connections || 0),
            lastHeartbeat: String(data.lastHeartbeat || Date.now()),
            timestamp: String(data.timestamp || Date.now()),
            version: String(data.version || 1)
        };

        if (data.activeSessionId) {
            redisPayload.activeSessionId = String(data.activeSessionId);
        } else {
            await client.hDel(key, "activeSessionId");
        }

        await client.hSet(key, redisPayload);
        await client.expire(key, DEFAULT_TTL);
        return true;
    } catch (err) {
        console.error(`Error setting presence for astro ${astrologerId}:`, err);
        return false;
    }
};

/**
 * Handle validated state transitions
 */
const transitionStatus = async (astrologerId, nextStatus, sessionId = null) => {
    try {
        let presence = await getPresence(astrologerId);
        const now = Date.now();

        if (!presence) {
            presence = {
                status: "OFFLINE",
                connections: 0,
                lastHeartbeat: now,
                activeSessionId: null,
                timestamp: now,
                version: 0
            };
        }

        const currentStatus = presence.status;

        // Transition Rules Validation
        if (currentStatus === nextStatus && nextStatus !== "BUSY") {
            return presence; // No change
        }

        // Validate allowed transitions
        let allowed = false;
        if (currentStatus === "OFFLINE" && nextStatus === "ONLINE") allowed = true;
        if (currentStatus === "ONLINE" && nextStatus === "OFFLINE") allowed = true;
        if (currentStatus === "ONLINE" && nextStatus === "BUSY") allowed = true;
        if (currentStatus === "BUSY" && nextStatus === "ONLINE") allowed = true;
        if (currentStatus === "BUSY" && nextStatus === "OFFLINE") allowed = true;
        
        // Reconnection edge case (when browser disconnects and reconnects while in session)
        if (currentStatus === "BUSY" && nextStatus === "BUSY") allowed = true;

        if (!allowed) {
            throw new Error(`Invalid presence state transition from ${currentStatus} to ${nextStatus}`);
        }

        // Update fields
        presence.status = nextStatus;
        presence.timestamp = now;
        presence.version += 1;

        if (nextStatus === "BUSY") {
            if (sessionId) presence.activeSessionId = String(sessionId);
        } else {
            presence.activeSessionId = null;
        }

        // Write to Redis
        await setPresence(astrologerId, presence);

        // Sync with MongoDB (for fallback and lists)
        try {
            const isOnline = (nextStatus === "ONLINE" || nextStatus === "BUSY");
            const isAvailable = (nextStatus === "ONLINE");
            
            const updateFields = {
                isOnline,
                isAvailable
            };

            // Only clear manualOffline when going online.
            // Do not set manualOffline to true when a socket disconnects naturally,
            // as this is a connection-based offline state, not a user-initiated opt-out.
            if (nextStatus === "ONLINE") {
                updateFields.manualOffline = false;
            }
            
            await Astrologer.findByIdAndUpdate(astrologerId, {
                $set: updateFields
            });
        } catch (dbErr) {
            console.error(`MongoDB sync error during presence transition for ${astrologerId}:`, dbErr);
        }

        // Broadcast to subscription room if Socket.io is initialized
        try {
            const { getIO } = require("../config/socket");
            const io = getIO();
            if (io) {
                const eventPayload = {
                    astrologerId: String(astrologerId),
                    status: nextStatus,
                    timestamp: Math.floor(now / 1000),
                    version: presence.version,
                    activeSessionId: presence.activeSessionId
                };
                io.to(`astrologer:${astrologerId}`).emit("presence:status_changed", eventPayload);
                console.log(`📢 Broadcasted status change: Astrologer ${astrologerId} -> ${nextStatus} (v${presence.version})`);
            }
        } catch (socketErr) {
            console.log(`⚠️ Socket.io broadcast skipped for status transition (socket server not running or in test context)`);
        }

        return presence;
    } catch (err) {
        console.error(`Status transition error for ${astrologerId}:`, err.message);
        throw err;
    }
};

/**
 * Distributed booking lock to protect against session booking race conditions
 */
const acquireBookingLock = async (astrologerId, sessionId) => {
    const client = getRedisClient();
    if (!client || !client.isOpen) {
        throw new Error("Redis client unavailable; booking lock aborted.");
    }

    const lockKey = `${LOCK_PREFIX}${astrologerId}`;
    
    // Acquire simple lock with SETNX and 5s expire
    const acquired = await client.set(lockKey, "LOCKED", {
        NX: true,
        EX: 5
    });

    if (!acquired) {
        throw new Error("This astrologer is currently processing another booking request. Please try again.");
    }

    try {
        const presence = await getPresence(astrologerId);
        
        if (!presence || presence.status !== "ONLINE") {
            throw new Error("Astrologer is no longer available.");
        }

        // Transition status atomically to BUSY
        await transitionStatus(astrologerId, "BUSY", sessionId);
        
        // Release lock
        await client.del(lockKey);
        return true;
    } catch (err) {
        // Ensure lock is released on failure
        await client.del(lockKey);
        throw err;
    }
};

module.exports = {
    getPresence,
    setPresence,
    transitionStatus,
    acquireBookingLock
};
