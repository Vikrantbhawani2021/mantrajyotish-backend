const express = require("express");
const router = express.Router();

const razorpayController = require("../controllers/razorpay.controller");

// Create order for client
router.post("/order", razorpayController.createOrder);

// Verify payment signature from client
router.post("/verify", razorpayController.verifyPayment);

// Webhook endpoint (Razorpay will POST here)
router.post("/webhook", express.raw({ type: 'application/json' }), razorpayController.webhookHandler);

module.exports = router;
