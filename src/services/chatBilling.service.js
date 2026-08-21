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

            // If user has insufficient balance, end the chat session
            if ((user.walletBalance || 0) < rate) {
                stopBillingTimer(sessionId);
                session.status = "COMPLETED";
                session.endTime = new Date();
                await session.save();
                if (io) {
                    const endPayload = { sessionId, message: "Chat ended: insufficient wallet balance." };
                    io.to(`session_${sessionId}`).emit("chat_ended_insufficient_funds", endPayload);
                    const rawUser = session.user;
                    const userId = (rawUser && typeof rawUser === "object") ? String(rawUser._id || "") : String(rawUser || "");
                    if (userId) io.to(`user_${userId}`).emit("chat_ended_insufficient_funds", endPayload);
                }
                return;
            }

            // Normal 1-minute deduction
            user.walletBalance = parseFloat((user.walletBalance - rate).toFixed(2));
            astrologer.walletBalance = parseFloat(((astrologer.walletBalance || 0) + rate).toFixed(2));

            session.totalDurationMinutes += 1;
            session.totalAmountDeducted = parseFloat(((session.totalAmountDeducted || 0) + rate).toFixed(2));
            session.astrologerEarnings = parseFloat(((session.astrologerEarnings || 0) + rate).toFixed(2));

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

/**
 * End Active Chat Session & Reconcile Wallet Balances based on exact seconds
 */
const endChatSession = async (sessionId) => {
    const ChatSession = require("../models/chatSession.model");
    const User = require("../models/user.model");
    const Astrologer = require("../models/astro.model");

    const session = await ChatSession.findById(sessionId);
    if (!session) throw new Error("Chat session not found");

    if (session.status === "ACTIVE") {
        stopBillingTimer(sessionId);

        const endTime = new Date();
        const startTime = session.startTime;
        let durationSeconds = 0;
        let expectedCost = 0;

        if (startTime) {
            const durationMs = endTime.getTime() - new Date(startTime).getTime();
            durationSeconds = Math.max(0, Math.floor(durationMs / 1000));
            const ratePerMin = session.perMinuteRate || 20;
            const ratePerSec = ratePerMin / 60;
            expectedCost = parseFloat((durationSeconds * ratePerSec).toFixed(2));
        }

        session.status = "COMPLETED";
        session.endTime = endTime;
        session.totalDurationMinutes = Math.ceil(durationSeconds / 60);
        session.totalDurationSeconds = durationSeconds;

        // Billing Reconciliation: Charge user and pay astrologer for final seconds
        try {
            const user = await User.findById(session.user);
            const astrologer = await Astrologer.findById(session.astrologer);
            
            if (user && astrologer) {
                const chargedSoFar = session.totalAmountDeducted || 0;
                const difference = expectedCost - chargedSoFar;
                
                if (difference > 0) {
                    // Deduct remaining balance from user wallet
                    const prevUserBalance = user.walletBalance || 0;
                    user.walletBalance = Math.max(0, parseFloat((prevUserBalance - difference).toFixed(2)));
                    
                    // Add earnings to astrologer wallet
                    const prevAstroBalance = astrologer.walletBalance || 0;
                    astrologer.walletBalance = parseFloat((prevAstroBalance + difference).toFixed(2));
                    
                    session.totalAmountDeducted = expectedCost;
                    session.astrologerEarnings = expectedCost;
                    
                    await user.save();
                    await astrologer.save();
                    console.log(`💰 [Chat Reconciliation] Charged User ${user._id} extra ₹${difference}. Paid Astrologer ${astrologer._id} ₹${difference}. Full cost: ₹${expectedCost}`);
                } else {
                    session.totalAmountDeducted = Math.max(session.totalAmountDeducted || 0, expectedCost);
                    session.astrologerEarnings = Math.max(session.astrologerEarnings || 0, expectedCost);
                }
            }
        } catch (billingErr) {
            console.error("❌ Failed to reconcile chat billing on end:", billingErr);
        }

        await session.save();
    } else if (session.status === "PENDING") {
        session.status = "CANCELLED";
        await session.save();
    }

    // Restore astrologer availability if they are no longer in an active call/chat
    try {
        const Astrologer = require("../models/astro.model");
        const VideoSession = require("../models/videoSession.model");
        const astro = await Astrologer.findById(session.astrologer);
        if (astro) {
            // Clean up any stale active chat sessions first
            await ChatSession.updateMany(
                { astrologer: astro._id, status: "ACTIVE", _id: { $ne: session._id } },
                { $set: { status: "COMPLETED", endTime: new Date() } }
            );

            const activeChat = await ChatSession.findOne({ astrologer: astro._id, status: "ACTIVE", _id: { $ne: session._id } });
            const activeCall = await VideoSession.findOne({ astrologer: astro._id, status: "ACTIVE" });
            
            if (activeChat || activeCall) {
                // Keep BUSY if another session is active
                astro.isAvailable = false;
                await astro.save();
            } else {
                // No other active sessions. Check if socket connections still exist to determine ONLINE or OFFLINE
                const { getPresence, transitionStatus } = require("./presence.service");
                const presence = await getPresence(astro._id);
                const hasConnections = presence ? (presence.connections > 0) : true;
                const nextStatus = hasConnections ? "ONLINE" : "OFFLINE";
                
                await transitionStatus(astro._id, nextStatus);
                console.log(`📶 Astrologer ${astro.name || astro._id} presence transitioned to ${nextStatus} on chat session end`);
            }
        }
    } catch (e) {
        console.error("Error updating astrologer availability on chat end:", e);
    }

    return session;
};

module.exports = {
    startBillingTimer,
    stopBillingTimer,
    endChatSession
};
