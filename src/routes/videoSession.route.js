const express = require("express");
const router = express.Router();
const videoSessionController = require("../controllers/videoSession.controller");
const authMiddleware = require("../middlewares/auth.middleware");

// Agora Token Generation
router.post("/generate-token", videoSessionController.generateAgoraToken);

// Real-Time Audio & Video Call Lifecycle
router.post("/request", videoSessionController.requestCall);
router.get("/pending", videoSessionController.getPendingCallRequests);
router.get("/requests", videoSessionController.getPendingCallRequests);
router.get("/astrologer/:id", videoSessionController.getPendingCallRequests);
router.post("/accept", videoSessionController.acceptCall);
router.post("/accept/:id", videoSessionController.acceptCall);
router.post("/reject", videoSessionController.rejectCall);
router.post("/reject/:id", videoSessionController.rejectCall);
router.post("/end", videoSessionController.endCall);
router.post("/end/:id", videoSessionController.endCall);
router.post("/rate", videoSessionController.rateVideoSession);
router.post("/rate/:id", videoSessionController.rateVideoSession);
router.get("/history", videoSessionController.getCallHistory);

// Legacy Scheduled Video Session Endpoints
router.post("/create", videoSessionController.createVideoSession);
router.post("/start", videoSessionController.startVideoSession);
router.post("/start/:id", videoSessionController.startVideoSession);
router.get("/all", videoSessionController.getAllVideoSessions);
const sessionAuthMiddleware = require("../middlewares/sessionAuth.middleware");
router.get("/:id", authMiddleware, sessionAuthMiddleware, videoSessionController.getVideoSessionById);
router.put("/update/:id", authMiddleware, videoSessionController.updateVideoSession);
router.delete("/delete/:id", authMiddleware, videoSessionController.deleteVideoSession);

module.exports = router;