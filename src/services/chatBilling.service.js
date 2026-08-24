const ChatSession = require("../models/chatSession.model");
const User = require("../models/user.model");
const Astrologer = require("../models/astro.model");

// In-memory store for active chat timers: sessionId -> { timeoutId, intervalId }
const activeTimers = new Map();

/**
 * Start per-second billing simulation and wallet limit timeout for an active chat session
 */
const startBillingTimer = (sessionId, io) => {
    const key = sessionId.toString();

    // Prevent duplicate billing timers
    if (activeTimers.has(key)) {
        return;
    }

    setTimeout(async () => {
        try {
            const session = await ChatSession.findById(sessionId);
            if (!session || session.status !== "ACTIVE") {
                return;
            }

            const user = await User.findById(session.user);
            if (!user) return;

            // Flat rate of 9 Rupees per minute for all chats
            const rate = 9;
            const ratePerSec = rate / 60;
            const userBalance = Number(user.walletBalance) || 0;

            // Calculate max allowed duration in seconds
            const maxSeconds = Math.max(1, Math.floor(userBalance / ratePerSec));
            console.log(`⏱️ Chat ${sessionId} starting. Rate: ₹${rate}/min. User Balance: ₹${userBalance}. Max allowed duration: ${maxSeconds}s.`);

            // 1. Timeout to end the chat automatically when balance runs out
            const timeoutId = setTimeout(async () => {
                try {
                    console.log(`🚨 Auto-ending chat session ${sessionId} due to zero wallet balance.`);
                    stopBillingTimer(sessionId);
                    
                    const endedSession = await endChatSession(sessionId);

                    if (io) {
                        const endPayload = { sessionId, message: "Chat ended: insufficient wallet balance." };
                        io.to(`session_${sessionId}`).emit("chat_ended_insufficient_funds", endPayload);
                        io.to(`session_${sessionId}`).emit("chat_ended", { success: true, session: endedSession });
                        
                        const userId = String(endedSession.user);
                        if (userId) io.to(`user_${userId}`).emit("chat_ended_insufficient_funds", endPayload);
                    }
                } catch (timeoutErr) {
                    console.error("Error in chat billing timeout:", timeoutErr.message);
                }
            }, maxSeconds * 1000);

            // 2. Interval to broadcast timer ticks to clients (every 10 seconds)
            const intervalId = setInterval(async () => {
                try {
                    const freshSession = await ChatSession.findById(sessionId);
                    if (!freshSession || freshSession.status !== "ACTIVE") {
                        stopBillingTimer(sessionId);
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
                        io.to(`session_${sessionId}`).emit("timer_tick", tickPayload);
                        io.to(`session_${sessionId}`).emit("timerTick", tickPayload);

                        // Emit wallet warning if less than 1 minute of balance remains
                        if (remainingBalance < rate) {
                            io.to(`session_${sessionId}`).emit("wallet_warning", {
                                message: "Your wallet balance is low. Please recharge to continue the chat.",
                                remainingBalance
                            });
                        }
                    }
                } catch (intervalErr) {
                    console.error("Error in chat billing interval tick:", intervalErr.message);
                }
            }, 10000); // every 10 seconds

            activeTimers.set(key, { timeoutId, intervalId });

        } catch (err) {
            console.error("Error starting chat billing timer:", err.message);
        }
    }, 1000);
};

/**
 * Stop billing timer for a session
 */
const stopBillingTimer = (sessionId) => {
    const key = sessionId.toString();
    if (activeTimers.has(key)) {
        const timers = activeTimers.get(key);
        clearTimeout(timers.timeoutId);
        clearInterval(timers.intervalId);
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
            const ratePerMin = 9; // Flat 9 Rupees per minute
            const ratePerSec = ratePerMin / 60;
            expectedCost = parseFloat((durationSeconds * ratePerSec).toFixed(2));
        }

        const expectedAstroEarnings = parseFloat((expectedCost * 0.60).toFixed(2));
        const expectedPlatFee = parseFloat((expectedCost * 0.40).toFixed(2));

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
                    
                    // Add 60% earnings difference to astrologer wallet
                    const astroDiff = parseFloat((expectedAstroEarnings - (session.astrologerEarnings || 0)).toFixed(2));
                    const prevAstroBalance = astrologer.walletBalance || 0;
                    astrologer.walletBalance = parseFloat((prevAstroBalance + astroDiff).toFixed(2));

                    // Add 40% platform fee difference to admin wallet for company profit
                    const platDiff = parseFloat((expectedPlatFee - (session.platformFee || 0)).toFixed(2));
                    const Admin = require("../models/admin.model");
                    const adminObj = await Admin.findOne();
                    if (adminObj) {
                        adminObj.walletBalance = parseFloat(((adminObj.walletBalance || 0) + platDiff).toFixed(2));
                        await adminObj.save();
                    }
                    
                    session.totalAmountDeducted = expectedCost;
                    session.astrologerEarnings = expectedAstroEarnings;
                    session.platformFee = expectedPlatFee;
                    
                    await user.save();
                    await astrologer.save();
                    console.log(`💰 [Chat Reconciliation] Charged User ${user._id} extra ₹${difference}. Paid Astrologer ${astrologer._id} ₹${astroDiff}. Company Profit: ₹${platDiff}. Full cost: ₹${expectedCost}`);
                } else {
                    session.totalAmountDeducted = Math.max(session.totalAmountDeducted || 0, expectedCost);
                    session.astrologerEarnings = Math.max(session.astrologerEarnings || 0, expectedAstroEarnings);
                    session.platformFee = Math.max(session.platformFee || 0, expectedPlatFee);
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
