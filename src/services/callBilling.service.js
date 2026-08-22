const VideoSession = require("../models/videoSession.model");
const User = require("../models/user.model");
const Astrologer = require("../models/astro.model");

// In-memory store for active call session timers: sessionId -> IntervalId
const activeCallTimers = new Map();

/**
 * Start per-minute billing recurring timer for an active audio/video call session
 */
const startCallBillingTimer = (sessionId, io) => {
    const key = sessionId.toString();

    // Prevent duplicate billing timers
    if (activeCallTimers.has(key)) {
        return;
    }

    const intervalId = setInterval(async () => {
        try {
            const session = await VideoSession.findById(sessionId);
            if (!session || (session.status !== "ACTIVE" && session.status !== "live")) {
                stopCallBillingTimer(sessionId);
                return;
            }

            const user = await User.findById(session.user);
            const astrologer = await Astrologer.findById(session.astrologer);

            if (!user || !astrologer) {
                stopCallBillingTimer(sessionId);
                return;
            }

            // Flat rate of 9 Rupees per minute for all astrologers/calls
            const rate = 9;
            const astroEarnings = parseFloat((rate * 0.60).toFixed(2));
            const platFee = parseFloat((rate * 0.40).toFixed(2));

            // If user has insufficient balance, end the session
            if ((user.walletBalance || 0) < rate) {
                stopCallBillingTimer(sessionId);
                session.status = "COMPLETED";
                session.endTime = new Date();
                await session.save();
                if (io) {
                    const endPayload = { sessionId, message: "Call ended: insufficient wallet balance." };
                    io.to(`call_${sessionId}`).emit("call_ended_insufficient_funds", endPayload);
                    const rawUser = session.user;
                    const userId = (rawUser && typeof rawUser === "object") ? String(rawUser._id || "") : String(rawUser || "");
                    if (userId) io.to(`user_${userId}`).emit("call_ended_insufficient_funds", endPayload);
                }
                return;
            }

            // Deduct per-minute rate from user
            user.walletBalance = parseFloat((user.walletBalance - rate).toFixed(2));
            
            // Add 60% to astrologer wallet balance
            astrologer.walletBalance = parseFloat(((astrologer.walletBalance || 0) + astroEarnings).toFixed(2));

            // Add 40% to admin wallet balance for company profit
            const Admin = require("../models/admin.model");
            const adminObj = await Admin.findOne();
            if (adminObj) {
                adminObj.walletBalance = parseFloat(((adminObj.walletBalance || 0) + platFee).toFixed(2));
                await adminObj.save();
            }

            session.totalDurationMinutes += 1;
            session.totalAmountDeducted = parseFloat(((session.totalAmountDeducted || 0) + rate).toFixed(2));
            session.astrologerEarnings = parseFloat(((session.astrologerEarnings || 0) + astroEarnings).toFixed(2));
            session.platformFee = parseFloat(((session.platformFee || 0) + platFee).toFixed(2));

            await user.save();
            await astrologer.save();
            await session.save();

            // Emit live timer update tick
            if (io) {
                io.to(`call_${sessionId}`).emit("timer_tick", {
                    sessionId,
                    elapsedMinutes: session.totalDurationMinutes,
                    remainingBalance: user.walletBalance,
                    totalDeducted: session.totalAmountDeducted
                });

                // Send warning if user balance is low (< 1 minute rate remaining)
                if (user.walletBalance < rate) {
                    io.to(`call_${sessionId}`).emit("wallet_warning", {
                        message: "Your wallet balance is low. Please recharge to continue the call.",
                        remainingBalance: user.walletBalance
                    });
                }
            }

        } catch (error) {
            console.error(`[Call Billing Timer Error - Session ${sessionId}]:`, error);
        }
    }, 60000); // 60-second billing interval

    activeCallTimers.set(key, intervalId);
    console.log(`⏱️ Billing timer started for Call Session: ${sessionId}`);
};

/**
 * Stop billing timer for a call session
 */
const stopCallBillingTimer = (sessionId) => {
    const key = sessionId.toString();
    if (activeCallTimers.has(key)) {
        clearInterval(activeCallTimers.get(key));
        activeCallTimers.delete(key);
        console.log(`🛑 Billing timer stopped for Call Session: ${sessionId}`);
    }
};

module.exports = {
    startCallBillingTimer,
    stopCallBillingTimer
};
