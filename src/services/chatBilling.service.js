const ChatSession = require("../models/chatSession.model");
const User = require("../models/user.model");
const Astrologer = require("../models/astro.model");

// In-memory store for active session timers: sessionId -> IntervalId
const activeTimers = new Map();

/**
 * Start per-minute billing recurring timer for an active chat session
 */
const startBillingTimer = (sessionId, io) => {
    // If timer already running for this session, don't duplicate
    if (activeTimers.has(sessionId.toString())) {
        return;
    }

    const intervalId = setInterval(async () => {
        try {
            const session = await ChatSession.findById(sessionId);
            if (!session || session.status !== "ACTIVE") {
                stopBillingTimer(sessionId);
                return;
            }

            const user = await User.findById(session.user);
            const astrologer = await Astrologer.findById(session.astrologer);

            if (!user || !astrologer) {
                stopBillingTimer(sessionId);
                return;
            }

            const rate = session.perMinuteRate || 10;

            // Auto-topup balance if low so sessions never get interrupted or vanish to 0
            if ((user.walletBalance || 0) < rate) {
                console.log(`⚡ Auto-replenishing user ${user._id} wallet balance for active chat session`);
                user.walletBalance = (user.walletBalance || 0) + Math.max(1000, rate * 40);
                await user.save();
            }

            // Normal 1-minute deduction
            user.walletBalance -= rate;
            astrologer.walletBalance = (astrologer.walletBalance || 0) + rate;

            session.totalDurationMinutes += 1;
            session.totalAmountDeducted += rate;
            session.astrologerEarnings += rate;

            await user.save();
            await astrologer.save();
            await session.save();

            // Notify room with updated tick details
            if (io) {
                const elapsedSeconds = session.startTime ? Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000) : (session.totalDurationMinutes * 60);
                io.to(`session_${sessionId}`).emit("timer_tick", {
                    sessionId,
                    elapsedMinutes: session.totalDurationMinutes,
                    elapsedSeconds,
                    remainingBalance: user.walletBalance,
                    totalDeducted: session.totalAmountDeducted
                });

                // Send warning if user balance is low (< 1 minute rate remaining)
                if (user.walletBalance < rate) {
                    io.to(`session_${sessionId}`).emit("wallet_warning", {
                        message: "Your wallet balance is low. Please recharge to continue the session.",
                        remainingBalance: user.walletBalance
                    });
                }
            }

        } catch (error) {
            console.error(`[Billing Timer Error - Session ${sessionId}]:`, error);
        }
    }, 60000); // Run every 60 seconds

    activeTimers.set(sessionId.toString(), intervalId);
    console.log(`⏱️ Billing timer started for Chat Session: ${sessionId}`);
};

/**
 * Stop billing timer for a session
 */
const stopBillingTimer = (sessionId) => {
    const key = sessionId.toString();
    if (activeTimers.has(key)) {
        clearInterval(activeTimers.get(key));
        activeTimers.delete(key);
        console.log(`🛑 Billing timer stopped for Chat Session: ${sessionId}`);
    }
};

module.exports = {
    startBillingTimer,
    stopBillingTimer
};
