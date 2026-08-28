const VideoSession = require("../models/videoSession.model");
const User = require("../models/user.model");
const Astrologer = require("../models/astro.model");

// In-memory store for active call timers: sessionId -> { timeoutId, intervalId, isPaused, pausedAt, safetyTimeoutId }
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
            // Cap the delay at the maximum 32-bit signed integer limit (2147483647 ms) to avoid instant triggers on large balances
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
            }, Math.min(2147483647, maxSeconds * 1000));

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

            activeCallTimers.set(key, { timeoutId, intervalId, isPaused: false, pausedAt: null });

        } catch (err) {
            console.error("Error starting call billing timer:", err.message);
        }
    }, 1000);
};

/**
 * Pause call billing (triggered when user clicks Recharge)
 */
const pauseCallBilling = async (sessionId, io) => {
    const key = sessionId.toString();
    if (!activeCallTimers.has(key)) return;

    const timers = activeCallTimers.get(key);
    if (timers.isPaused) return;

    // Clear active zero-balance timeout and interval tick
    clearTimeout(timers.timeoutId);
    clearInterval(timers.intervalId);

    timers.isPaused = true;
    timers.pausedAt = Date.now();

    // 120-second safety timeout to end call if user does not recharge/resume
    timers.safetyTimeoutId = setTimeout(async () => {
        try {
            console.log(`🚨 Pause safety limit reached. Auto-ending call session ${sessionId}.`);
            stopCallBillingTimer(sessionId);
            
            const { endCallSession } = require("./videoSession.service");
            const endedSession = await endCallSession(sessionId);

            if (io) {
                const endPayload = { sessionId, message: "Call ended: recharge safety limit (2 min) exceeded." };
                io.to(`call_${sessionId}`).emit("call_ended_insufficient_funds", endPayload);
                io.to(`call_${sessionId}`).emit("call_ended", { success: true, session: endedSession });
            }
        } catch (err) {
            console.error("Error in call pause safety timeout:", err.message);
        }
    }, 120000); // 2 minutes

    activeCallTimers.set(key, timers);

    if (io) {
        io.to(`call_${sessionId}`).emit("billing_paused", {
            message: "User is recharging their wallet. Billing is temporarily paused."
        });
    }
    console.log(`⏸️ Billing paused for Call Session: ${sessionId}`);
};

/**
 * Resume call billing after wallet recharge
 */
const resumeCallBilling = async (sessionId, io) => {
    const key = sessionId.toString();
    if (!activeCallTimers.has(key)) return;

    const timers = activeCallTimers.get(key);
    if (!timers.isPaused) return;

    // Clear the 2-minute safety timeout
    clearTimeout(timers.safetyTimeoutId);

    const pauseDuration = Date.now() - timers.pausedAt;
    timers.isPaused = false;
    timers.pausedAt = null;

    try {
        const session = await VideoSession.findById(sessionId);
        const user = await User.findById(session.user);
        if (!session || !user) return;

        // Shift the startTime of the session forward by the pause duration
        if (session.startTime) {
            session.startTime = new Date(new Date(session.startTime).getTime() + pauseDuration);
            await session.save();
        }

        const rate = Number(session.perMinuteRate || session.rate || 9);
        const ratePerSec = rate / 60;
        const userBalance = Number(user.walletBalance) || 0;

        const startTime = session.startTime || new Date();
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 1000));
        const currentCost = elapsedSeconds * ratePerSec;

        // Recalculate remaining seconds allowed before balance runs out
        const remainingSeconds = Math.max(1, Math.floor((userBalance - currentCost) / ratePerSec));

        // Restart zero-balance timeout
        // Cap the delay at the maximum 32-bit signed integer limit (2147483647 ms) to avoid instant triggers on large balances
        timers.timeoutId = setTimeout(async () => {
            try {
                console.log(`🚨 Auto-ending call session ${sessionId} due to zero wallet balance.`);
                stopCallBillingTimer(sessionId);
                
                const { endCallSession } = require("./videoSession.service");
                const endedSession = await endCallSession(sessionId);

                if (io) {
                    const endPayload = { sessionId, message: "Call ended: insufficient wallet balance." };
                    io.to(`call_${sessionId}`).emit("call_ended_insufficient_funds", endPayload);
                    io.to(`call_${sessionId}`).emit("call_ended", { success: true, session: endedSession });
                }
            } catch (err) {
                console.error("Error in call billing timeout:", err.message);
            }
        }, Math.min(2147483647, remainingSeconds * 1000));

        // Restart interval ticks (every 10 seconds)
        timers.intervalId = setInterval(async () => {
            try {
                const freshSession = await VideoSession.findById(sessionId);
                if (!freshSession || (freshSession.status !== "ACTIVE" && freshSession.status !== "live")) {
                    stopCallBillingTimer(sessionId);
                    return;
                }

                const elapsed = Math.max(0, Math.floor((Date.now() - new Date(freshSession.startTime).getTime()) / 1000));
                const cost = parseFloat((elapsed * ratePerSec).toFixed(2));
                const bal = Math.max(0, parseFloat((userBalance - cost).toFixed(2)));

                if (io) {
                    const tickPayload = {
                        sessionId,
                        elapsedMinutes: Math.floor(elapsed / 60),
                        elapsedSeconds: elapsed,
                        remainingBalance: bal,
                        totalDeducted: cost
                    };
                    io.to(`call_${sessionId}`).emit("timer_tick", tickPayload);
                    io.to(`call_${sessionId}`).emit("timerTick", tickPayload);
                }
            } catch (intervalErr) {
                console.error("Error in call interval tick:", intervalErr.message);
            }
        }, 10000);

        activeCallTimers.set(key, timers);

        if (io) {
            io.to(`call_${sessionId}`).emit("billing_resumed", {
                message: "Wallet recharge successful. Billing has resumed.",
                remainingBalance: userBalance
            });
        }
        console.log(`▶️ Billing resumed for Call Session: ${sessionId}`);

    } catch (err) {
        console.error("Error resuming call billing:", err.message);
    }
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
        if (timers.safetyTimeoutId) clearTimeout(timers.safetyTimeoutId);
        activeCallTimers.delete(key);
        console.log(`🛑 Billing timer stopped for Call Session: ${sessionId}`);
    }
};

module.exports = {
    startCallBillingTimer,
    stopCallBillingTimer,
    pauseCallBilling,
    resumeCallBilling
};
