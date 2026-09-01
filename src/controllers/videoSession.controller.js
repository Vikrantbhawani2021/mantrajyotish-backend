const videoSessionService = require("../services/videoSession.service");
const { getIO } = require("../config/socket");
const { startCallBillingTimer, stopCallBillingTimer } = require("../services/callBilling.service");

const formatDate = (dateVal) => {
    if (!dateVal) return "Not Specified";
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
};

// 1. GENERATE AGORA RTC TOKEN
const generateAgoraToken = async (req, res) => {
    try {
        const { channelName, uid, role } = req.body;

        if (!channelName) {
            return res.status(400).json({
                success: false,
                message: "channelName is required"
            });
        }

        const tokenData = videoSessionService.generateAgoraToken(channelName, uid, role);

        return res.status(200).json({
            success: true,
            message: "Agora RTC Token generated successfully",
            data: tokenData
        });

    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// 2. REQUEST CALL (USER -> ASTROLOGER)
const requestCall = async (req, res) => {
    try {
        const { userId, astrologerId, callType, walletBalance } = req.body;

        const effectiveUserId = userId || req.body.user_id || req.body.user || "user_client";
        const effectiveAstroId = astrologerId || req.body.astrologer_id || req.body.astrologer || "astrologer";

        const session = await videoSessionService.requestCallSession({
            userId: effectiveUserId,
            astrologerId: effectiveAstroId,
            callType: callType || "VIDEO",
            walletBalance
        });

        // Notify Astrologer via Socket.io across all room variations
        try {
            const io = getIO();
            const Astrologer = require("../models/astro.model");
            let astroObj = null;
            const mongoose = require("mongoose");
            if (mongoose.Types.ObjectId.isValid(astrologerId)) {
                astroObj = await Astrologer.findById(astrologerId);
            }
            if (!astroObj) {
                astroObj = await Astrologer.findOne({ $or: [{ user: astrologerId }, { astrologerLogin: astrologerId }] });
            }

            const sessionUserObj = session.user && typeof session.user === "object" ? session.user : {};
            const resolvedUserName = sessionUserObj.name ||
                `${sessionUserObj.firstname || ""} ${sessionUserObj.lastname || ""}`.trim() ||
                (sessionUserObj.phone ? `User (${sessionUserObj.phone})` : "Client User");



            const flatUser = {
                _id: sessionUserObj._id || sessionUserObj.id || userId,
                id: sessionUserObj._id || sessionUserObj.id || userId,
                name: resolvedUserName,
                firstname: sessionUserObj.firstname || "",
                lastname: sessionUserObj.lastname || "",
                phone: sessionUserObj.phone || "",
                avatar: sessionUserObj.profileImage || sessionUserObj.avatar || "",
                profileImage: sessionUserObj.profileImage || sessionUserObj.avatar || "",
                dob: sessionUserObj.dateofbirth ? formatDate(sessionUserObj.dateofbirth) : (sessionUserObj.dob || "Not Specified"),
                tob: sessionUserObj.timeofbirth || sessionUserObj.tob || "Not Specified",
                pob: sessionUserObj.placeofbirth || sessionUserObj.pob || "Not Specified",
            };

            const payload = {
                sessionId: session._id,
                callId: session._id,
                _id: session._id,
                id: session._id,
                callType: session.callType,
                user: flatUser,
                astrologer: session.astrologer,
                perMinuteRate: session.perMinuteRate,
                channelName: session.channelName,
                sound: "ringtone.mp3",
                ringtoneUrl: "/public/sounds/ringtone.mp3",
                ringtoneDuration: 30,
                playRingtone: true
            };

            const targetRooms = new Set();
            targetRooms.add(`user_${astrologerId}`);
            targetRooms.add(`astro_${astrologerId}`);
            targetRooms.add(`astrologer_${astrologerId}`);
            targetRooms.add(String(astrologerId));

            if (astroObj) {
                if (astroObj._id) {
                    targetRooms.add(`user_${astroObj._id}`);
                    targetRooms.add(`astro_${astroObj._id}`);
                    targetRooms.add(String(astroObj._id));
                }
                if (astroObj.user) {
                    targetRooms.add(`user_${astroObj.user}`);
                    targetRooms.add(`astro_${astroObj.user}`);
                    targetRooms.add(String(astroObj.user));
                }
                if (astroObj.astrologerLogin) {
                    targetRooms.add(`user_${astroObj.astrologerLogin}`);
                    targetRooms.add(String(astroObj.astrologerLogin));
                }
            }

            // Emit to each target room
            targetRooms.forEach(room => {
                io.to(room).emit("incoming_call_request", payload);
            });

            // Global socket broadcast fallback removed for privacy.
            // Only targeted rooms receive the request.
            console.log(`📞 Successfully broadcasted incoming_call_request to ${targetRooms.size} rooms for session ${session._id}`);

        } catch (socketErr) {
            console.log("Socket notification error:", socketErr.message);
        }

        return res.status(201).json({
            success: true,
            message: "Call request created and sent to astrologer",
            data: session
        });

    } catch (error) {
        console.error("requestCall error:", error);
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// 3. ACCEPT CALL (ASTROLOGER -> USER)
const acceptCall = async (req, res) => {
    try {
        const { sessionId } = req.params.id ? { sessionId: req.params.id } : req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "sessionId is required"
            });
        }

        const result = await videoSessionService.acceptCallSession(sessionId);

        // Start Call Billing Timer
        try {
            const io = getIO();
            startCallBillingTimer(sessionId, io);

            // Notify call room & user across all room channels
            const responsePayload = {
                success: true,
                message: "Astrologer accepted call request",
                sessionId: result.session._id,
                callId: result.session._id,
                channelName: result.session.channelName || (result.agora && result.agora.channelName),
                agora: result.agora,
                appId: (result.agora && result.agora.appId) || "",
                token: (result.agora && result.agora.token) || "",
                session: result.session
            };

            const rawUser = result.session.user;
            const userIdForRoom = (rawUser && typeof rawUser === "object")
                ? String(rawUser._id || rawUser.id || "")
                : String(rawUser || "");

            io.to(`call_${sessionId}`).emit("call_accepted", responsePayload);
            if (userIdForRoom) {
                io.to(`user_${userIdForRoom}`).emit("call_accepted", responsePayload);
                io.to(userIdForRoom).emit("call_accepted", responsePayload);
            }
            io.emit("call_accepted", responsePayload);
            console.log(`✅ Successfully broadcasted call_accepted for session ${sessionId}`);
        } catch (socketErr) {
            console.log("Socket broadcast skipped:", socketErr.message);
        }

        return res.status(200).json({
            success: true,
            message: "Call request accepted. Live call started!",
            data: result
        });

    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// 4. REJECT CALL
const rejectCall = async (req, res) => {
    try {
        const { sessionId, reason } = req.body;
        const targetId = req.params.id || sessionId;

        if (!targetId) {
            return res.status(400).json({
                success: false,
                message: "sessionId is required"
            });
        }

        const session = await videoSessionService.rejectCallSession(targetId, reason);

        try {
            const io = getIO();
            const payload = {
                success: false,
                message: "Call request was rejected",
                reason: session.rejectionReason,
                session
            };
            io.to(`call_${targetId}`).emit("call_rejected", payload);

            // Also broadcast to user personal room in case they left the call room
            const rawUser = session.user;
            const userId = (rawUser && typeof rawUser === "object")
                ? String(rawUser._id || rawUser.id || "")
                : String(rawUser || "");
            if (userId) {
                io.to(`user_${userId}`).emit("call_rejected", payload);
                io.to(userId).emit("call_rejected", payload);
            }
        } catch (socketErr) {}

        return res.status(200).json({
            success: true,
            message: "Call request rejected",
            data: session
        });

    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// 5. END CALL SESSION
const endCall = async (req, res) => {
    try {
        const sessionId = req.params.id || req.body.sessionId;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: "sessionId is required"
            });
        }

        stopCallBillingTimer(sessionId);
        const session = await videoSessionService.endCallSession(sessionId);

        try {
            const io = getIO();
            const payload = {
                success: true,
                message: "Call session ended",
                session
            };
            io.to(`call_${sessionId}`).emit("call_ended", payload);

            // Safely broadcast to individual user and astrologer personal rooms
            const extractIdString = (val) => {
                if (!val) return "";
                if (typeof val === "string") return val;
                if (typeof val === "object") {
                    if (val._id) return String(val._id);
                    if (val.id) return String(val.id);
                }
                return String(val);
            };

            const userId = extractIdString(session.user);
            const astroId = extractIdString(session.astrologer);

            if (userId) {
                io.to(`user_${userId}`).emit("call_ended", payload);
                io.to(userId).emit("call_ended", payload);
            }
            if (astroId) {
                io.to(`user_${astroId}`).emit("call_ended", payload);
                io.to(`astro_${astroId}`).emit("call_ended", payload);
                io.to(`astrologer_${astroId}`).emit("call_ended", payload);
                io.to(astroId).emit("call_ended", payload);
            }
        } catch (socketErr) {}

        return res.status(200).json({
            success: true,
            message: "Call session ended successfully",
            data: session
        });

    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// 6. GET CALL HISTORY
const getCallHistory = async (req, res) => {
    try {
        const { userId, role } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "userId query parameter is required"
            });
        }

        const history = await videoSessionService.getCallHistory(userId, role || "user");

        return res.status(200).json({
            success: true,
            count: history.length,
            data: history
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Legacy compatibility endpoints
const createVideoSession = async (req, res) => {
    try {
        const result = await videoSessionService.createVideoSession(req.body);
        return res.status(201).json({ success: true, message: "Video Session Created", data: result });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const startVideoSession = async (req, res) => {
    try {
        const sessionId = req.params.id || req.body.sessionId;
        const result = await videoSessionService.startVideoSession(sessionId);
        return res.status(200).json({ success: true, message: "Video Session started", data: result });
    } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
};

const endVideoSession = async (req, res) => {
    return await endCall(req, res);
};

const getAllVideoSessions = async (req, res) => {
    try {
        const sessions = await videoSessionService.getAllVideoSessions();
        return res.status(200).json({ success: true, count: sessions.length, data: sessions });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getVideoSessionById = async (req, res) => {
    try {
        const session = await videoSessionService.getVideoSessionById(req.params.id);
        if (!session) return res.status(404).json({ success: false, message: "Video Session Not Found" });
        return res.status(200).json({ success: true, data: session });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const updateVideoSession = async (req, res) => {
    try {
        const session = await videoSessionService.updateVideoSession(req.params.id, req.body);
        if (!session) return res.status(404).json({ success: false, message: "Video Session Not Found" });
        return res.status(200).json({ success: true, message: "Updated", data: session });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const deleteVideoSession = async (req, res) => {
    try {
        const session = await videoSessionService.deleteVideoSession(req.params.id);
        if (!session) return res.status(404).json({ success: false, message: "Video Session Not Found" });
        return res.status(200).json({ success: true, message: "Deleted" });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const getPendingCallRequests = async (req, res) => {
    try {
        const astrologerId = req.query.astrologerId || req.query.astroId || req.query.userId || req.params.id;
        if (!astrologerId) {
            return res.status(200).json({ success: true, count: 0, data: [] });
        }

        const Astrologer = require("../models/astro.model");
        const mongoose = require("mongoose");
        let astroObj = null;
        if (mongoose.Types.ObjectId.isValid(astrologerId)) {
            astroObj = await Astrologer.findById(astrologerId);
        }
        if (!astroObj) {
            astroObj = await Astrologer.findOne({ $or: [{ user: astrologerId }, { astrologerLogin: astrologerId }] });
        }

        const astroIds = [astrologerId];
        if (astroObj) {
            if (astroObj._id) astroIds.push(astroObj._id.toString());
            if (astroObj.user) astroIds.push(astroObj.user.toString());
        }

        const VideoSession = require("../models/videoSession.model");
        const twoMinutesAgo = new Date(Date.now() - 2 * 60000); // 120 seconds limit
        const pendingSessions = await VideoSession.find({
            astrologer: { $in: astroIds },
            status: "PENDING",
            createdAt: { $gte: twoMinutesAgo }
        }).sort({ createdAt: -1 }).populate("user", "firstname lastname phone profileImage dateofbirth timeofbirth placeofbirth name").lean();

        const formatted = pendingSessions.map(s => {
            const userObj = s.user || {};
            const resolvedName = userObj.name || `${userObj.firstname || ""} ${userObj.lastname || ""}`.trim() || userObj.phone || "Client User";
            return {
                sessionId: s._id,
                callId: s._id,
                _id: s._id,
                id: s._id,
                callType: s.callType,
                user: {
                    _id: userObj._id,
                    id: userObj._id,
                    name: resolvedName,
                    phone: userObj.phone || "",
                    avatar: userObj.profileImage || "",
                    profileImage: userObj.profileImage || "",
                    dob: userObj.dateofbirth ? formatDate(userObj.dateofbirth) : (userObj.dob || "Not Specified"),
                    tob: userObj.timeofbirth || userObj.tob || "Not Specified",
                    pob: userObj.placeofbirth || userObj.pob || "Not Specified",
                },
                astrologer: s.astrologer,
                perMinuteRate: s.perMinuteRate,
                channelName: s.channelName,
                createdAt: s.createdAt
            };
        });

        return res.status(200).json({
            success: true,
            count: formatted.length,
            data: formatted
        });
    } catch (error) {
        console.error("getPendingCallRequests error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// 7. RATE CALL SESSION
const rateVideoSession = async (req, res) => {
    try {
        const sessionId = req.params.id || req.body.sessionId;
        const { rating, review } = req.body;

        if (!sessionId || !rating) {
            return res.status(400).json({ success: false, message: "sessionId and rating are required." });
        }

        const numRating = parseFloat(rating);
        if (isNaN(numRating) || numRating < 1 || numRating > 5) {
            return res.status(400).json({ success: false, message: "Rating must be between 1 and 5." });
        }

        const VideoSession = require("../models/videoSession.model");
        const Astrologer = require("../models/astro.model");

        const session = await VideoSession.findById(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found." });
        }

        session.rating = numRating;
        if (review) session.review = review;
        await session.save();

        // Recalculate astrologer average rating from all rated sessions
        const astrologer = await Astrologer.findById(session.astrologer);
        if (astrologer) {
            const allRated = await VideoSession.find({ astrologer: session.astrologer, rating: { $ne: null } });
            const total = allRated.reduce((sum, s) => sum + s.rating, 0);
            astrologer.rating = Number((total / allRated.length).toFixed(1));
            astrologer.totalReviews = allRated.length;
            await astrologer.save();
        }

        return res.status(200).json({
            success: true,
            message: "Rating submitted successfully.",
            data: session
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {
    generateAgoraToken,
    requestCall,
    acceptCall,
    rejectCall,
    endCall,
    rateVideoSession,
    getCallHistory,
    getPendingCallRequests,
    createVideoSession,
    startVideoSession,
    endVideoSession,
    getAllVideoSessions,
    getVideoSessionById,
    updateVideoSession,
    deleteVideoSession
};