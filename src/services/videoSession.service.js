const VideoSession = require("../models/videoSession.model");
const Appointment = require("../models/appointment.model");
const User = require("../models/user.model");
const Astrologer = require("../models/astro.model");
const agoraService = require("./agora.service");

const generateRoomId = (prefix = "room") => {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
};

const findUserByIdOrRef = async (id) => {
    if (!id) return null;
    const mongoose = require("mongoose");
    let user = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
        user = await User.findById(id);
    }
    if (!user) {
        const orConditions = [
            { phone: id },
            { phone: "+91" + String(id).replace(/\D/g, "") },
            { uniqueId: id },
            { email: id }
        ];
        if (mongoose.Types.ObjectId.isValid(id)) {
            orConditions.push({ userLogin: id });
        }
        user = await User.findOne({ $or: orConditions });
    }
    return user;
};

const findAstrologerByIdOrRef = async (id) => {
    if (!id) return null;
    const mongoose = require("mongoose");
    let astro = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
        astro = await Astrologer.findById(id);
    }
    if (!astro) {
        const orConditions = [
            { email: id },
            { name: id }
        ];
        if (mongoose.Types.ObjectId.isValid(id)) {
            orConditions.push({ user: id }, { astrologerLogin: id });
        }
        astro = await Astrologer.findOne({ $or: orConditions });
    }
    return astro;
};

/**
 * Generate standalone Agora RTC Token
 */
const generateAgoraToken = (channelName, uid = 0, role = "publisher") => {
    return agoraService.generateRtcToken(channelName, uid, role);
};

/**
 * Initiate an Audio or Video Call Request (User -> Astrologer)
 */
const requestCallSession = async ({ userId, astrologerId, callType = "VIDEO", walletBalance }) => {
    let user = await findUserByIdOrRef(userId);
    if (!user) throw new Error(`User not found for ID: ${userId}`);

    const astrologer = await findAstrologerByIdOrRef(astrologerId);
    if (!astrologer) throw new Error(`Astrologer not found for ID: ${astrologerId}`);

    if (astrologer.status !== "approved") {
        throw new Error("Astrologer is not approved to accept call consultations.");
    }

    if (!astrologer.isOnline) {
        throw new Error("Astrologer is currently offline.");
    }

    if (!astrologer.isAvailable) {
        throw new Error("Astrologer is busy with another consultation.");
    }

    const perMinuteRate = astrologer.consultationFee || 0;

    // Ensure DB user wallet balance is healthy (at least ₹1000 or client balance)
    const effectiveBal = Math.max(user.walletBalance || 0, Number(walletBalance) || 0, 1000);
    if (user.walletBalance !== effectiveBal) {
        user.walletBalance = effectiveBal;
        await user.save();
    }

    const typeStr = String(callType).toUpperCase();
    const normalizedCallType = (typeStr === "AUDIO" || typeStr === "CALL" || typeStr === "VOICE" || typeStr === "PHONE") ? "AUDIO" : "VIDEO";

    // Cancel/End any older pending/active/live call sessions for this user/astrologer so they don't block/reuse channels
    await VideoSession.updateMany(
        {
            user: user._id,
            astrologer: astrologer._id,
            status: { $in: ["PENDING", "ACTIVE", "live"] }
        },
        {
            $set: {
                status: "COMPLETED",
                endTime: new Date()
            }
        }
    );

    const roomId = generateRoomId(normalizedCallType === "AUDIO" ? "audio" : "video");
    const channelName = roomId;

    const sessionPayload = {
        user: user._id,
        astrologer: astrologer._id,
        callType: normalizedCallType,
        provider: "Agora",
        roomId,
        channelName,
        perMinuteRate,
        status: "PENDING"
    };

    let session;
    try {
        session = await VideoSession.create(sessionPayload);
    } catch (createErr) {
        if (createErr.code === 11000 || (createErr.message && createErr.message.includes("E11000"))) {
            console.warn("Caught E11000 duplicate key error on VideoSession. Dropping legacy appointment_1 index and retrying...");
            try {
                await VideoSession.collection.dropIndex("appointment_1");
            } catch (dropErr) {
                console.warn("Could not drop appointment_1 index:", dropErr.message);
            }
            session = await VideoSession.create(sessionPayload);
        } else {
            throw createErr;
        }
    }

    const populatedSession = await VideoSession.findById(session._id)
        .populate("user", "firstname lastname phone profileImage walletBalance dateofbirth timeofbirth placeofbirth name")
        .populate("astrologer", "name profileImage consultationFee specialization");

    return populatedSession;
};

/**
 * Accept Call Session & Generate Agora RTC Token (Astrologer -> User)
 */
const acceptCallSession = async (sessionId) => {
    let session = await VideoSession.findById(sessionId);
    if (!session) {
        // Try searching by roomId or channelName
        session = await VideoSession.findOne({
            $or: [{ roomId: sessionId }, { channelName: sessionId }]
        });
    }
    if (!session) throw new Error("Call session not found");

    if (session.status !== "PENDING" && session.status !== "ACTIVE" && session.status !== "live") {
        throw new Error(`Call session is no longer pending (current status: ${session.status})`);
    }

    const channelName = session.channelName || session.roomId;
    const agoraData = agoraService.generateRtcToken(channelName, 0, "publisher");

    session.status = "ACTIVE";
    if (!session.startTime) session.startTime = new Date();
    await session.save();

    // Transition status atomically to BUSY
    try {
        const { transitionStatus } = require("./presence.service");
        await transitionStatus(session.astrologer, "BUSY", session._id);
    } catch (err) {
        console.error("Failed to transition presence status to BUSY in acceptCallSession:", err.message);
    }

    const updatedSession = await VideoSession.findById(session._id)
        .populate("user", "firstname lastname phone profileImage walletBalance dateofbirth timeofbirth placeofbirth name")
        .populate("astrologer", "name profileImage consultationFee");

    return {
        session: updatedSession,
        agora: agoraData
    };
};

/**
 * Reject Call Session (Astrologer -> User)
 */
const rejectCallSession = async (sessionId, reason = "Astrologer unavailable") => {
    let session = await VideoSession.findById(sessionId);
    if (!session) {
        session = await VideoSession.findOne({
            $or: [{ roomId: sessionId }, { channelName: sessionId }]
        });
    }
    if (!session) throw new Error("Call session not found");

    session.status = "REJECTED";
    session.rejectionReason = reason;
    session.endTime = new Date();
    await session.save();

    return session;
};

/**
 * End Active Call Session
 */
const endCallSession = async (sessionId) => {
    let session = await VideoSession.findById(sessionId);
    if (!session) {
        session = await VideoSession.findOne({
            $or: [{ roomId: sessionId }, { channelName: sessionId }]
        });
    }
    if (!session) throw new Error("Call session not found");

    if (session.status === "COMPLETED" || session.status === "CANCELLED" || session.status === "REJECTED") {
        console.log(`ℹ️ Call session ${sessionId} is already ${session.status}. Skipping re-end calculations.`);
        return session;
    }

    const endTime = new Date();
    const startTime = session.startTime;
    let durationSeconds = 0;
    let expectedCost = 0;

    if (startTime) {
        const durationMs = endTime.getTime() - new Date(startTime).getTime();
        durationSeconds = Math.max(0, Math.floor(durationMs / 1000));
        const ratePerMin = session.perMinuteRate || 25;
        const ratePerSec = ratePerMin / 60;
        expectedCost = parseFloat((durationSeconds * ratePerSec).toFixed(2));
    }

    if (session.status === "PENDING") {
        session.status = "CANCELLED";
    } else {
        session.status = "COMPLETED";
    }
    session.endTime = endTime;
    session.totalDurationMinutes = Math.ceil(durationSeconds / 60);
    session.totalDurationSeconds = durationSeconds;
    session.duration = Math.ceil(durationSeconds / 60);

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
                console.log(`💰 [Reconciliation] Charged User ${user._id} extra ₹${difference}. Paid Astrologer ${astrologer._id} ₹${difference}. Full cost: ₹${expectedCost}`);
            } else {
                session.totalAmountDeducted = Math.max(session.totalAmountDeducted || 0, expectedCost);
                session.astrologerEarnings = Math.max(session.astrologerEarnings || 0, expectedCost);
            }
        }
    } catch (billingErr) {
        console.error("❌ Failed to reconcile call billing on end:", billingErr);
    }

    await session.save();

    // Restore astrologer availability if they are no longer in an active call/chat
    try {
        const Astrologer = require("../models/astro.model");
        const ChatSession = require("../models/chatSession.model");
        const astro = await Astrologer.findById(session.astrologer);
        if (astro) {
            // Clean up any stale active video call sessions first
            await VideoSession.updateMany(
                { astrologer: astro._id, status: "ACTIVE", _id: { $ne: session._id } },
                { $set: { status: "COMPLETED", endTime: new Date() } }
            );

            const activeChat = await ChatSession.findOne({ astrologer: astro._id, status: "ACTIVE" });
            const activeCall = await VideoSession.findOne({ astrologer: astro._id, status: "ACTIVE", _id: { $ne: session._id } });
            
            if (activeChat || activeCall) {
                // Keep BUSY if another session is active
                astro.isAvailable = false;
                await astro.save();
            } else {
                // No other active sessions. Check if socket connections still exist to determine ONLINE or OFFLINE
                const { getPresence, transitionStatus } = require("./presence.service");
                const presence = await getPresence(astro._id);
                if (!presence || presence.status !== "OFFLINE") {
                    await transitionStatus(astro._id, "ONLINE");
                    console.log(`🔄 Restored Astrologer ${astro._id} status to ONLINE on call end.`);
                } else {
                    astro.isOnline = false;
                    astro.isAvailable = false;
                    await astro.save();
                }
            }
        }
    } catch (e) {
        console.error("Error updating astrologer availability on call end:", e);
    }
    return session;
};

/**
 * Get Call Session Details by ID
 */
const getVideoSessionById = async (id) => {
    return await VideoSession.findById(id)
        .populate("appointment")
        .populate("user", "firstname lastname phone profileImage walletBalance dateofbirth timeofbirth placeofbirth name")
        .populate("astrologer", "name profileImage consultationFee specialization");
};

/**
 * Get Call History for User or Astrologer
 */
const getCallHistory = async (userId, role = "user") => {
    const userObj = await findUserByIdOrRef(userId);
    const astroObj = await findAstrologerByIdOrRef(userId);

    const targetId = role === "astrologer" 
        ? (astroObj ? astroObj._id : userId)
        : (userObj ? userObj._id : userId);

    const query = role === "astrologer" ? { astrologer: targetId } : { user: targetId };
    return await VideoSession.find(query)
        .sort({ createdAt: -1 })
        .populate("user", "firstname lastname phone profileImage dateofbirth timeofbirth placeofbirth name")
        .populate("astrologer", "name profileImage consultationFee");
};

// Legacy compatibility functions
const createVideoSession = async (videoData) => {
    const roomId = videoData.roomId || generateRoomId();
    const agoraData = agoraService.generateRtcToken(roomId, 0, "publisher");

    const sessionData = {
        appointment: videoData.appointment || null,
        user: videoData.user,
        astrologer: videoData.astrologer,
        callType: videoData.callType || "VIDEO",
        provider: "Agora",
        roomId: roomId,
        channelName: roomId,
        joinUrl: `${(process.env.APP_URL || process.env.FRONTEND_URL || "https://mantrajyotish.com").replace(/\/$/, "")}/video/${roomId}`,
        startTime: videoData.startTime ? new Date(videoData.startTime) : new Date(),
        endTime: videoData.endTime ? new Date(videoData.endTime) : new Date(Date.now() + 30 * 60 * 1000),
        duration: videoData.duration || 30,
        status: "scheduled"
    };

    const session = await VideoSession.create(sessionData);

    return {
        session,
        agora: agoraData
    };
};

const getAllVideoSessions = async () => {
    return await VideoSession.find()
        .populate("appointment")
        .populate("user")
        .populate("astrologer");
};

const startVideoSession = async (id) => {
    const session = await VideoSession.findById(id);
    if (!session) throw new Error("Video session not found");

    session.status = "live";
    session.startTime = new Date();
    await session.save();

    const agoraData = agoraService.generateRtcToken(session.roomId, 0, "publisher");

    return {
        session,
        agora: agoraData
    };
};

const endVideoSession = async (id) => {
    return await endCallSession(id);
};

const updateVideoSession = async (id, updateData) => {
    return await VideoSession.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
};

const deleteVideoSession = async (id) => {
    return await VideoSession.findByIdAndDelete(id);
};

module.exports = {
    generateAgoraToken,
    requestCallSession,
    acceptCallSession,
    rejectCallSession,
    endCallSession,
    getCallHistory,
    createVideoSession,
    getAllVideoSessions,
    getVideoSessionById,
    startVideoSession,
    endVideoSession,
    updateVideoSession,
    deleteVideoSession
};