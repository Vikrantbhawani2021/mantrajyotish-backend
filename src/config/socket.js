const formatDate = (dateVal) => {
    if (!dateVal) return "Not Specified";
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
};

const { Server } = require("socket.io");
const ChatSession = require("../models/chatSession.model");
const ChatMessage = require("../models/chatMessage.model");
const VideoSession = require("../models/videoSession.model");
const User = require("../models/user.model");
const Astrologer = require("../models/astro.model");
const { startBillingTimer, stopBillingTimer } = require("../services/chatBilling.service");
const { startCallBillingTimer, stopCallBillingTimer } = require("../services/callBilling.service");
const videoSessionService = require("../services/videoSession.service");

let io;

const extractSessionId = (data) => {
    if (!data) return null;
    if (typeof data === "string") return data;
    return data.sessionId || data.chatId || data.callId || data._id || data.id || (data.session && (data.session._id || data.session.id)) || null;
};

const broadcastAstroStatus = (astroId, isOnline, isAvailable) => {
    if (io) {
        io.emit("astrologer_status_changed", {
            astrologerId: String(astroId),
            isOnline: Boolean(isOnline),
            isAvailable: Boolean(isAvailable)
        });
        console.log(`📢 Broadcast status change: Astrologer ${astroId} isOnline=${isOnline}, isAvailable=${isAvailable}`);
    }
};

const cleanupStaleSessions = async (astrologerId) => {
    try {
        const ChatSession = require("../models/chatSession.model");
        const VideoSession = require("../models/videoSession.model");
        const { endChatSession } = require("../services/chatBilling.service");
        const { endCallSession } = require("../services/videoSession.service");

        // Consider sessions older than 30 minutes as stale
        const staleTime = new Date(Date.now() - 30 * 60 * 1000);

        const staleChats = await ChatSession.find({
            astrologer: astrologerId,
            status: { $in: ["ACTIVE", "PENDING"] },
            createdAt: { $lt: staleTime }
        });

        for (const session of staleChats) {
            console.log(`🧹 Auto-ending stale chat session ${session._id} for astrologer ${astrologerId}`);
            await endChatSession(session._id).catch(err => console.error("Error auto-ending stale chat:", err));
        }

        const staleCalls = await VideoSession.find({
            astrologer: astrologerId,
            status: { $in: ["ACTIVE", "PENDING"] },
            createdAt: { $lt: staleTime }
        });

        for (const session of staleCalls) {
            console.log(`🧹 Auto-ending stale call session ${session._id} for astrologer ${astrologerId}`);
            await endCallSession(session._id).catch(err => console.error("Error auto-ending stale call:", err));
        }
    } catch (err) {
        console.error("Failed to run cleanupStaleSessions:", err);
    }
};

const findUserByIdOrRef = async (id) => {
    if (!id) return null;
    const mongoose = require("mongoose");
    let user = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
        user = await User.findById(id);
    }
    if (!user) {
        user = await User.findOne({
            $or: [
                { phone: id },
                { phone: "+91" + String(id).replace(/\D/g, "") },
                { uniqueId: id },
                { userLogin: id },
                { email: id }
            ]
        });
    }
    if (!user) {
        user = await User.findOne().sort({ createdAt: -1 });
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
        astro = await Astrologer.findOne({
            $or: [{ user: id }, { astrologerLogin: id }, { email: id }]
        });
    }
    if (!astro) {
        astro = await Astrologer.findOne({ isApproved: true }) || await Astrologer.findOne();
    }
    return astro;
};

const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST", "PUT", "DELETE"]
        }
    });

    io.on("connection", (socket) => {
        console.log(`🔌 New Socket Connection Established: ${socket.id}`);

        // Register User or Astrologer to all their personal notification room variations
        const handleJoinRegistration = async (data) => {
            if (!data) return;
            let id = null;
            if (typeof data === "string" || typeof data === "number") {
                id = String(data);
            } else if (typeof data === "object") {
                id = data.userId || data.astrologerId || data.id || data._id;
            }
            if (id) {
                const strId = String(id);
                socket.join(strId);
                socket.join(`user_${strId}`);
                socket.join(`astro_${strId}`);
                socket.join(`astrologer_${strId}`);
                socket.join(`room_${strId}`);
                console.log(`👤 Socket ${socket.id} registered in room variations for ID: ${strId}`);
                
                // Track associated ID on socket
                socket.associatedUserId = strId;

                // Check if this ID is an astrologer and mark them as online/available
                const mongoose = require("mongoose");
                if (mongoose.Types.ObjectId.isValid(strId)) {
                    const astro = await Astrologer.findOne({
                        $or: [
                            { _id: strId },
                            { user: strId },
                            { astrologerLogin: strId }
                        ]
                    });
                    if (astro) {
                        socket.associatedAstroId = astro._id.toString();
                        
                        // Clean up any stale sessions first to restore availability
                        await cleanupStaleSessions(astro._id);

                        // Only change isOnline to true if they are currently offline
                        if (!astro.isOnline) {
                            astro.isOnline = true;
                            // Check if they are busy
                            const activeChat = await ChatSession.findOne({ astrologer: astro._id, status: "ACTIVE" });
                            const activeCall = await VideoSession.findOne({ astrologer: astro._id, status: "ACTIVE" });
                            astro.isAvailable = !activeChat && !activeCall;
                            await astro.save();
                            console.log(`🟢 Astrologer ${astro.name} (${astro._id}) is now ONLINE & ${astro.isAvailable ? 'AVAILABLE' : 'BUSY'}`);
                            
                            // Broadcast status change to all clients
                            broadcastAstroStatus(astro._id, astro.isOnline, astro.isAvailable);

                            // Invalidate Redis online listing cache
                            try {
                                const { deleteCache } = require("../services/redis.service");
                                await deleteCache("online_astrologers");
                            } catch (err) {
                                console.error("Failed to clear Redis online cache on handleJoinRegistration:", err);
                            }
                        }
                    }
                }
            }
        };

        ["register_user", "register_astrologer", "register", "join", "join_astrologer", "subscribe", "join_user"].forEach(evt => {
            socket.on(evt, handleJoinRegistration);
        });

        // =====================================
        // CHAT SESSION SOCKET EVENTS
        // =====================================

        // 1. Initiate Chat Request via Socket
        const handleChatRequest = async (data) => {
            try {
                const userId = data ? (data.userId || data.user) : null;
                const astrologerId = data ? (data.astrologerId || data.astrologer) : null;

                if (!userId || !astrologerId) {
                    socket.emit("error", { message: "userId and astrologerId are required." });
                    return;
                }

                const userObj = await findUserByIdOrRef(userId);
                if (!userObj) {
                    socket.emit("error", { message: `User not found for ID: ${userId}` });
                    return;
                }

                const astroObj = await findAstrologerByIdOrRef(astrologerId);
                if (!astroObj) {
                    socket.emit("error", { message: `Astrologer not found for ID: ${astrologerId}` });
                    return;
                }

                if (astroObj.status !== "approved") {
                    socket.emit("error", { message: "Astrologer is not approved to take consultations yet." });
                    return;
                }

                if (!astroObj.isOnline) {
                    socket.emit("error", { message: "Astrologer is currently offline." });
                    return;
                }

                if (!astroObj.isAvailable) {
                    socket.emit("error", { message: "Astrologer is busy with another consultation." });
                    return;
                }

                const perMinuteRate = astroObj.consultationFee || 0;
                const minBalanceRequired = perMinuteRate * 2;

                if ((userObj.walletBalance || 0) < minBalanceRequired) {
                    socket.emit("error", {
                        message: `Insufficient wallet balance. Minimum ₹${minBalanceRequired} (2 mins) required to initiate chat. Current Balance: ₹${userObj.walletBalance || 0}`
                    });
                    return;
                }

                let session = await ChatSession.findOne({
                    user: userObj._id,
                    astrologer: astroObj._id,
                    status: { $in: ["PENDING", "ACTIVE"] }
                });

                if (!session) {
                    session = await ChatSession.create({
                        user: userObj._id,
                        astrologer: astroObj._id,
                        perMinuteRate,
                        status: "PENDING"
                    });
                }

                const incomingName = data ? (data.name || data.userName || data.fullName || (data.user && (data.user.name || data.user.userName))) : null;
                const dbName = userObj.name || `${userObj.firstname || ""} ${userObj.lastname || ""}`.trim() || userObj.username;
                const resolvedName = (incomingName && typeof incomingName === "string" && incomingName.trim())
                    ? incomingName.trim()
                    : (dbName || (userObj.phone ? `User (${userObj.phone})` : "Client User"));

                if (incomingName && (!userObj.name || userObj.name === "Client User")) {
                    userObj.name = incomingName;
                    await userObj.save().catch(() => null);
                }

                const userDetails = {
                    _id: userObj._id,
                    id: userObj._id,
                    name: resolvedName,
                    firstname: userObj.firstname || resolvedName.split(" ")[0],
                    lastname: userObj.lastname || resolvedName.split(" ").slice(1).join(" "),
                    phone: userObj.phone || "",
                    email: userObj.email || "",
                    profileImage: userObj.profileImage || userObj.avatar || "",
                    dob: userObj.dateofbirth ? formatDate(userObj.dateofbirth) : (userObj.dob || "Not Specified"),
                    tob: userObj.timeofbirth || userObj.tob || "Not Specified",
                    pob: userObj.placeofbirth || userObj.pob || "Not Specified",
                    gender: userObj.gender || "Not Specified"
                };

                const responseData = {
                    ...session.toObject(),
                    user: userDetails,
                    sessionId: session._id,
                    chatId: session._id,
                    _id: session._id,
                    id: session._id
                };

                socket.join(`session_${session._id}`);

                const payload = {
                    message: "New incoming chat request!",
                    session: responseData,
                    sessionId: session._id,
                    _id: session._id,
                    user: userDetails
                };

                io.to(`user_${astroObj._id}`).emit("incoming_chat_request", payload);
                if (astroObj.user) io.to(`user_${astroObj.user}`).emit("incoming_chat_request", payload);
                if (astroObj.astrologerLogin) io.to(`user_${astroObj.astrologerLogin}`).emit("incoming_chat_request", payload);
                io.to(`session_${session._id}`).emit("incoming_chat_request", payload);

                socket.emit("chat_request_created", {
                    success: true,
                    message: "Chat request initiated successfully.",
                    session: responseData
                });

            } catch (err) {
                console.error("handleChatRequest error:", err);
                socket.emit("error", { message: err.message || "Failed to initiate chat request." });
            }
        };

        socket.on("request_chat", handleChatRequest);
        socket.on("initiate_chat", handleChatRequest);

        // 2. Join Chat Session Room
        const handleJoinRoom = async (data) => {
            const sessionId = extractSessionId(data);
            if (!sessionId) return;

            const cleanId = String(sessionId);
            socket.join(`session_${cleanId}`);
            socket.join(cleanId);
            socket.join(`chat_${cleanId}`);
            socket.join(`room_${cleanId}`);
            console.log(`👤 Socket ${socket.id} joined chat room channels for session: ${cleanId}`);

            try {
                const mongoose = require("mongoose");
                if (mongoose.Types.ObjectId.isValid(cleanId)) {
                    const session = await ChatSession.findById(cleanId).catch(() => null);
                    if (session) {
                        socket.emit("session_state", { 
                            session,
                            sessionId: session._id,
                            _id: session._id
                        });
                    }
                }
            } catch (err) {
                console.error("Error fetching session on join:", err);
            }
        };

        socket.on("join_session", handleJoinRoom);
        socket.on("join_room", handleJoinRoom);
        socket.on("join_chat", handleJoinRoom);
        socket.on("join", handleJoinRoom);
        socket.on("subscribe", handleJoinRoom);

        // Allow register_user with just a plain string or object
        socket.on("join_user", (data) => {
            const rawId = typeof data === "string" ? data : (data?.userId || data?.id || data?._id || "");
            const cleanId = String(rawId).replace("user_", "");
            if (cleanId) {
                socket.join(`user_${cleanId}`);
                console.log(`👤 Socket ${socket.id} force-joined personal room: user_${cleanId}`);
            }
        });

        // 3. Real-Time Instant Messaging (User <-> Astrologer)
        const handleSendMessageSocket = async (data) => {
            try {
                const sessionId = extractSessionId(data);
                const senderId = data ? (data.senderId || data.userId || data.astrologerId) : null;
                const senderType = data ? data.senderType : null;
                const messageType = (data && data.messageType) || "text";
                const text = data ? data.text : "";
                const mediaUrl = data ? data.mediaUrl : null;

                // Only require sessionId and content (senderId can be resolved from session)
                if (!sessionId || (!text && !mediaUrl)) {
                    socket.emit("error", { message: "Invalid message payload: missing sessionId or content." });
                    return;
                }

                const mongoose = require("mongoose");
                let session = null;
                if (mongoose.Types.ObjectId.isValid(sessionId)) {
                    session = await ChatSession.findById(sessionId).catch(() => null);
                }

                const normalizedSenderType = String(senderType || "USER").toUpperCase() === "ASTROLOGER" ? "ASTROLOGER" : "USER";

                const validSenderId = (senderId && mongoose.Types.ObjectId.isValid(senderId))
                    ? senderId
                    : (session ? (normalizedSenderType === "ASTROLOGER" ? session.astrologer : session.user) : new mongoose.Types.ObjectId());

                let newMessage;
                if (session) {
                    newMessage = await ChatMessage.create({
                        session: sessionId,
                        senderId: validSenderId,
                        senderType: normalizedSenderType,
                        messageType,
                        text,
                        mediaUrl
                    });
                } else {
                    newMessage = {
                        session: sessionId,
                        senderId: validSenderId,
                        senderType: normalizedSenderType,
                        messageType,
                        text,
                        mediaUrl,
                        _id: new mongoose.Types.ObjectId(),
                        createdAt: new Date()
                    };
                }

                const cleanSessionId = String(sessionId);
                const formattedMsg = {
                    ...(newMessage.toObject ? newMessage.toObject() : newMessage),
                    session: cleanSessionId,
                    sessionId: cleanSessionId,
                    chatId: cleanSessionId,
                    roomId: cleanSessionId,
                    senderType: normalizedSenderType,
                    _id: String(newMessage._id),
                    id: String(newMessage._id)
                };

                // Broadcast ONCE using chained .to() so Socket.io automatically deduplicates sockets
                let emitter = io.to(`session_${cleanSessionId}`).to(cleanSessionId);
                if (session) {
                    if (session.user) emitter = emitter.to(`user_${session.user}`);
                    if (session.astrologer) {
                        emitter = emitter.to(`user_${session.astrologer}`);
                        const astro = await Astrologer.findById(session.astrologer).catch(() => null);
                        if (astro) {
                            if (astro.user) emitter = emitter.to(`user_${astro.user}`);
                            if (astro.astrologerLogin) emitter = emitter.to(`user_${astro.astrologerLogin}`);
                        }
                    }
                }
                emitter.emit("receive_message", formattedMsg);

            } catch (error) {
                console.error("Socket send_message error:", error);
                socket.emit("error", { message: "Failed to send message" });
            }
        };

        socket.on("send_message", handleSendMessageSocket);
        socket.on("send_chat_message", handleSendMessageSocket);

        // 4. Typing Indicator Status
        socket.on("typing_status", (data) => {
            const sessionId = extractSessionId(data);
            if (!sessionId) return;
            socket.to(`session_${sessionId}`).emit("user_typing", { 
                senderType: data.senderType, 
                isTyping: Boolean(data.isTyping),
                sessionId,
                _id: sessionId
            });
        });

        // 5. Astrologer Accepts Chat Request
        socket.on("accept_chat_request", async (data) => {
            try {
                const sessionId = extractSessionId(data);
                if (!sessionId) return;

                const session = await ChatSession.findById(sessionId);
                if (!session || session.status !== "PENDING") {
                    socket.emit("error", { message: "Session is no longer pending or not found." });
                    return;
                }

                session.status = "ACTIVE";
                session.startTime = new Date();
                await session.save();

                // Mark astrologer as busy/unavailable in real time
                const astro = await Astrologer.findById(session.astrologer);
                if (astro) {
                    astro.isAvailable = false;
                    await astro.save();
                    console.log(`📶 Astrologer ${astro.name} is now BUSY (active chat started via Socket)`);
                    
                    // Broadcast status change to all clients
                    broadcastAstroStatus(astro._id, astro.isOnline, astro.isAvailable);

                    // Invalidate Redis online listing cache
                    try {
                        const { deleteCache } = require("../services/redis.service");
                        await deleteCache("online_astrologers");
                    } catch (err) {
                        console.error("Failed to clear Redis online cache on accept_chat_request Socket:", err);
                    }
                }

                startBillingTimer(sessionId, io);

                const responsePayload = {
                    success: true,
                    message: "Astrologer accepted chat request. Live session started!",
                    session,
                    sessionId: session._id,
                    _id: session._id,
                    id: session._id
                };

                io.to(`session_${sessionId}`).emit("chat_accepted", responsePayload);
                io.to(`user_${session.user}`).emit("chat_accepted", responsePayload);
            } catch (err) {
                console.error("accept_chat_request socket error:", err);
            }
        });

        // 6. Astrologer Rejects Chat Request
        socket.on("reject_chat_request", async (data) => {
            try {
                const sessionId = extractSessionId(data);
                if (!sessionId) return;

                const session = await ChatSession.findById(sessionId);
                if (session) {
                    session.status = "REJECTED";
                    session.rejectionReason = data.reason || "Astrologer unavailable";
                    await session.save();

                    const responsePayload = {
                        success: false,
                        message: "Astrologer rejected chat request.",
                        reason: session.rejectionReason,
                        session,
                        sessionId: session._id,
                        _id: session._id
                    };

                    io.to(`session_${sessionId}`).emit("chat_rejected", responsePayload);
                    io.to(`user_${session.user}`).emit("chat_rejected", responsePayload);
                }
            } catch (err) {
                console.error("reject_chat_request socket error:", err);
            }
        });

        socket.on("end_chat_session", async (data) => {
            try {
                const sessionId = extractSessionId(data);
                if (!sessionId) return;

                const { endChatSession } = require("../services/chatBilling.service");
                const session = await endChatSession(sessionId);

                io.to(`session_${sessionId}`).emit("chat_ended", {
                    success: true,
                    message: "Chat session ended successfully.",
                    session,
                    sessionId: session._id,
                    _id: session._id
                });
            } catch (err) {
                console.error("end_chat_session socket error:", err);
            }
        });


        // =====================================
        // AUDIO & VIDEO CALL SOCKET EVENTS
        // =====================================

        // 1. Join Audio/Video Call Room
        socket.on("join_call_room", async (data) => {
            const sessionId = extractSessionId(data);
            if (!sessionId) return;

            const roomName = `call_${sessionId}`;
            socket.join(roomName);
            console.log(`📞 Socket ${socket.id} joined call room: ${roomName}`);

            try {
                const session = await VideoSession.findById(sessionId);
                socket.emit("call_state", {
                    session,
                    sessionId: session ? session._id : sessionId
                });
            } catch (err) {
                console.error("Error fetching call session on join:", err);
            }
        });

        // 2. User Requests Audio or Video Call
        socket.on("request_call", async (data) => {
            try {
                const userId = data ? (data.userId || data.user) : null;
                const astrologerId = data ? (data.astrologerId || data.astrologer) : null;
                const callType = (data && data.callType) ? data.callType : "VIDEO";

                if (!userId || !astrologerId) {
                    socket.emit("error", { message: "Invalid payload: missing userId or astrologerId." });
                    return;
                }

                const session = await videoSessionService.requestCallSession({
                    userId,
                    astrologerId,
                    callType
                });

                socket.join(`call_${session._id}`);

                // Build flattened user details for IncomingCallModal
                const sessionUserObj = session.user && typeof session.user === "object" ? session.user : {};
                const resolvedUserName = sessionUserObj.name ||
                    `${sessionUserObj.firstname || ""} ${sessionUserObj.lastname || ""}`.trim() ||
                    (sessionUserObj.phone ? `User (${sessionUserObj.phone})` : "Client");

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
                    callType: session.callType,
                    user: flatUser,
                    astrologer: session.astrologer,
                    perMinuteRate: session.perMinuteRate,
                    channelName: session.channelName
                };

                const astroObj = await findAstrologerByIdOrRef(astrologerId);
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

                targetRooms.forEach(room => {
                    io.to(room).emit("incoming_call_request", payload);
                });

                io.to(`call_${session._id}`).emit("incoming_call_request", payload);
                // Removed global broadcast for privacy. Only targeted astrologer receives this.

                socket.emit("call_request_sent", {
                    success: true,
                    message: "Call request sent to astrologer. Waiting for response...",
                    session
                });

            } catch (error) {
                console.error("request_call socket error:", error);
                socket.emit("error", { message: error.message || "Failed to initiate call request." });
            }
        });

        // 3. Astrologer Accepts Call Request
        socket.on("accept_call_request", async (data) => {
            try {
                const sessionId = extractSessionId(data);
                if (!sessionId) return;

                const result = await videoSessionService.acceptCallSession(sessionId);

                socket.join(`call_${sessionId}`);

                startCallBillingTimer(sessionId, io);

                // Safely extract user ID whether session.user is populated object or plain ID string
                const rawUser = result.session.user;
                const userIdForRoom = (rawUser && typeof rawUser === "object")
                    ? String(rawUser._id || rawUser.id || "")
                    : String(rawUser || "");

                const responsePayload = {
                    success: true,
                    message: "Call request accepted! Agora RTC token generated.",
                    sessionId: result.session._id,
                    callType: result.session.callType,
                    channelName: result.session.channelName || result.agora.channelName,
                    agora: result.agora,
                    appId: result.agora.appId,
                    token: result.agora.token,
                    session: result.session
                };

                io.to(`call_${sessionId}`).emit("call_accepted", responsePayload);
                if (userIdForRoom) io.to(`user_${userIdForRoom}`).emit("call_accepted", responsePayload);

            } catch (err) {
                console.error("accept_call_request socket error:", err);
                socket.emit("error", { message: err.message || "Failed to accept call request." });
            }
        });

        // 4. Astrologer Rejects Call Request
        socket.on("reject_call_request", async (data) => {
            try {
                const sessionId = extractSessionId(data);
                if (!sessionId) return;

                const reason = data ? (data.reason || "Astrologer busy") : "Astrologer busy";
                const session = await videoSessionService.rejectCallSession(sessionId, reason);

                // Safely extract user ID whether session.user is populated object or plain ID
                const rawUser = session.user;
                const userIdForRoom = (rawUser && typeof rawUser === "object")
                    ? String(rawUser._id || rawUser.id || "")
                    : String(rawUser || "");

                const responsePayload = {
                    success: false,
                    message: "Call request was rejected.",
                    reason: session.rejectionReason,
                    session
                };

                io.to(`call_${sessionId}`).emit("call_rejected", responsePayload);
                if (userIdForRoom) io.to(`user_${userIdForRoom}`).emit("call_rejected", responsePayload);

            } catch (err) {
                console.error("reject_call_request socket error:", err);
            }
        });

        // 5. End Audio/Video Call Session
        socket.on("end_call_session", async (data) => {
            try {
                const sessionId = extractSessionId(data);
                if (!sessionId) return;

                stopCallBillingTimer(sessionId);
                const session = await videoSessionService.endCallSession(sessionId);

                const payload = {
                    success: true,
                    message: "Call session ended successfully.",
                    session
                };

                io.to(`call_${sessionId}`).emit("call_ended", payload);

                // Safely broadcast to individual user and astrologer personal rooms
                const rawUser = session.user;
                const userId = (rawUser && typeof rawUser === "object")
                    ? String(rawUser._id || rawUser.id || "")
                    : String(rawUser || "");

                const rawAstro = session.astrologer;
                const astroId = (rawAstro && typeof rawAstro === "object")
                    ? String(rawAstro._id || rawAstro.id || "")
                    : String(rawAstro || "");

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

            } catch (err) {
                console.error("end_call_session socket error:", err);
            }
        });

        // 6. Mute / Camera Toggle State Sync
        socket.on("media_state_change", (data) => {
            const sessionId = extractSessionId(data);
            if (!sessionId) return;

            socket.to(`call_${sessionId}`).emit("peer_media_state_changed", {
                isAudioMuted: Boolean(data.isAudioMuted),
                isVideoMuted: Boolean(data.isVideoMuted),
                senderType: data.senderType
            });
        });


        // Disconnect Handler
        socket.on("disconnect", async () => {
            console.log(`🔌 Socket Disconnected: ${socket.id}`);
            if (socket.associatedAstroId) {
                const astroId = socket.associatedAstroId;
                
                // Use fetchSockets to check if this astrologer has any other open tabs/connections
                try {
                    const sockets = await io.in(`user_${astroId}`).fetchSockets();
                    if (sockets.length === 0) {
                        const astro = await Astrologer.findById(astroId);
                        if (astro) {
                            astro.isOnline = false;
                            astro.isAvailable = false;
                            await astro.save();
                            console.log(`🔴 Astrologer ${astro.name} (${astro._id}) is now OFFLINE`);
                            
                            // Broadcast status change to all clients
                            broadcastAstroStatus(astro._id, astro.isOnline, astro.isAvailable);

                            // Invalidate Redis online listing cache
                            try {
                                const { deleteCache } = require("../services/redis.service");
                                await deleteCache("online_astrologers");
                            } catch (err) {
                                console.error("Failed to clear Redis online cache on disconnect:", err);
                            }
                        }
                    } else {
                        console.log(`📶 Astrologer ${astroId} disconnected one socket, but has ${sockets.length} other connections active.`);
                    }
                } catch (err) {
                    console.error("Error updating astrologer offline status on disconnect:", err);
                }
            }
        });
    });

    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error("Socket.io not initialized!");
    }
    return io;
};

module.exports = {
    initSocket,
    getIO,
    cleanupStaleSessions
};
