const express = require("express");

const router = express.Router();
const authMiddleware = require("../middlewares/auth.middleware");

const {
    createAstrologerLogin,
    loginAstrologer,
    forgotPasswordSendOtp,
    forgotPasswordReset,
    getApprovalStatus
} = require("../controllers/astrologerLogin.controller");

router.post("/register", createAstrologerLogin);
router.post("/login", loginAstrologer);
router.post("/forgot-password/send-otp", forgotPasswordSendOtp);
router.post("/forgot-password/reset", forgotPasswordReset);
router.get("/approval-status", authMiddleware, getApprovalStatus);

module.exports = router;