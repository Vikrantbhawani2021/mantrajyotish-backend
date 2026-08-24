const VideoSession = require("../models/videoSession.model");
const ChatSession = require("../models/chatSession.model");

const sessionAuthMiddleware = async (req, res, next) => {
    try {
        const userId = req.user.id || req.user.userId || req.user._id;
        const id = req.params.id || req.params.sessionId;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized: Missing user credentials" });
        }

        // Search in video session first
        let session = await VideoSession.findById(id).catch(() => null);
        if (!session) {
            // Search in chat session
            session = await ChatSession.findById(id).catch(() => null);
        }

        if (!session) {
            return res.status(404).json({ success: false, message: "Consultation session not found" });
        }

        // Secure verification: check if authenticated user belongs to session
        const sessionUser = String(session.user && (session.user._id || session.user));
        const sessionAstro = String(session.astrologer && (session.astrologer._id || session.astrologer));
        const requestUser = String(userId);

        if (requestUser !== sessionUser && requestUser !== sessionAstro) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: You are not authorized to access this consultation session"
            });
        }

        req.sessionObj = session;
        next();
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error during session authorization: " + error.message
        });
    }
};

module.exports = sessionAuthMiddleware;
