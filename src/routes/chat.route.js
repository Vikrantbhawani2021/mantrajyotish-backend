const express = require("express");
const router = express.Router();

const chatController = require("../controllers/chat.controller");

// Chat Lifecycle APIs
router.post("/initiate", chatController.initiateChat);
router.post("/accept", chatController.acceptChat);
router.post("/reject", chatController.rejectChat);
router.post("/end", chatController.endChat);
router.post("/send", chatController.sendMessage);
router.post("/message", chatController.sendMessage);

// Chat History & Listing APIs
router.get("/history/:sessionId", chatController.getChatHistory);
router.get("/sessions", chatController.getMySessions);
const authMiddleware = require("../middlewares/auth.middleware");
const sessionAuthMiddleware = require("../middlewares/sessionAuth.middleware");
router.get("/details/:sessionId", authMiddleware, sessionAuthMiddleware, chatController.getSessionDetails);

// Rating & Review API
router.post("/rate", chatController.rateChat);

module.exports = router;
