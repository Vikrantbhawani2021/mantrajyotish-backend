const VideoSession = require("../models/videoSession.model");
const User = require("../models/user.model");
const Astrologer = require("../models/astro.model");

// In-memory store for active call timers: sessionId -> { timeoutId, intervalId }
const activeCallTimers = new Map();

/**
 * Start per-second billing simulation and wallet limit timeout for an active call session
 */
const startCallBillingTimer = (sessionId, io) => {
    const key = sessionId.toString();

    // Prevent duplicate billing timers
    if (activeCallTimers.has(key)) {
        return;
    }

    // Set a timeout to fetch the session and calculate the duration
    setTimeout(async () => {
        try {
            const session = await VideoSession.findById(sessionId);
            if (!session || (session.status !== "ACTIVE" && session.status !== "live")) {
                return;
            }

            const user = await User.findById(session.user);
            if (!user) return;

            const rate = Number(session.perMinuteRate || session.rate || 9);
            const ratePerSec = rate / 60;
            const userBalance = Number(user.walletBalance) || 0;

            // Calculate max allowed duration in seconds
            const maxSeconds = Math.max(1, Math.floor(userBalance / ratePerSec));
            console.log(`⏱️ Call ${sessionId} starting. Rate: ₹${rate}/min. User Balance: ₹${userBalance}. Max allowed duration: ${maxSeconds}s.`);

            // 1. Timeout to end the call automatically when balance runs out
            const timeoutId = setTimeout(async () => {
                try {
                    console.log(`🚨 Auto-ending call session ${sessionId} due to zero wallet balance.`);
                    stopCallBillingTimer(sessionId);
                    
                    const { endCallSession } = require("./videoSession.service");
                    const endedSession = await endCallSession(sessionId);

                    if (io) {
                        const endPayload = { sessionId, message: "Call ended: insufficient wallet balance." };
                        io.to(`call_${sessionId}`).emit("call_ended_insufficient_funds", endPayload);
                        io.to(`call_${sessionId}`).emit("call_ended", { success: true, session: endedSession });
                        
                        const userId = String(endedSession.user);
                        if (userId) io.to(`user_${userId}`).emit("call_ended_insufficient_funds", endPayload);
                    }
                } catch (timeoutErr) {
                    console.error("Error in call billing timeout:", timeoutErr.message);
                }
            }, maxSeconds * 1000);

            // 2. Interval to broadcast timer ticks to clients (every 10 seconds)
            const intervalId = setInterval(async () => {
                try {
                    const freshSession = await VideoSession.findById(sessionId);
                    if (!freshSession || (freshSession.status !== "ACTIVE" && freshSession.status !== "live")) {
                        stopCallBillingTimer(sessionId);
                        return;
                    }

                    const startTime = freshSession.startTime || new Date();
                    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000));
                    const currentCost = parseFloat((elapsedSeconds * ratePerSec).toFixed(2));
                    const remainingBalance = Math.max(0, parseFloat((userBalance - currentCost).toFixed(2)));

                    if (io) {
                        const tickPayload = {
                            sessionId,
                            elapsedMinutes: Math.floor(elapsedSeconds / 60),
                            elapsedSeconds,
                            remainingBalance,
                            totalDeducted: currentCost
                        };
                        io.to(`call_${sessionId}`).emit("timer_tick", tickPayload);
                        io.to(`call_${sessionId}`).emit("timerTick", tickPayload);

                        // Emit wallet warning if less than 1 minute of balance remains
                        if (remainingBalance < rate) {
                            io.to(`call_${sessionId}`).emit("wallet_warning", {
                                message: "Your wallet balance is low. Please recharge to continue the call.",
                                remainingBalance
                            });
                        }
                    }
                } catch (intervalErr) {
                    console.error("Error in call billing interval tick:", intervalErr.message);
                }
            }, 10000); // every 10 seconds

            activeCallTimers.set(key, { timeoutId, intervalId });

        } catch (err) {
            console.error("Error starting call billing timer:", err.message);
        }
    }, 1000);
};

/**
 * Stop billing timer for a call session
 */
const stopCallBillingTimer = (sessionId) => {
    const key = sessionId.toString();
    if (activeCallTimers.has(key)) {
        const timers = activeCallTimers.get(key);
        clearTimeout(timers.timeoutId);
        clearInterval(timers.intervalId);
        activeCallTimers.delete(key);
        console.log(`🛑 Billing timer stopped for Call Session: ${sessionId}`);
    }
};

module.exports = {
    startCallBillingTimer,
    stopCallBillingTimer
};
