const express = require("express");
const router = express.Router();
const User = require("../models/user.model");
const mongoose = require("mongoose");

/**
 * Robust User Resolver: Finds user by MongoDB _id, phone, uniqueId, email, or userLogin
 */
const findUserByIdentifier = async (identifier, phoneFallback = null) => {
    if (!identifier && !phoneFallback) return null;

    let user = null;

    // 1. Try finding by MongoDB ObjectId
    if (identifier && mongoose.Types.ObjectId.isValid(identifier)) {
        user = await User.findById(identifier);
    }

    // 2. Try finding by phone, uniqueId, or email
    if (!user && identifier) {
        user = await User.findOne({
            $or: [
                { phone: identifier },
                { uniqueId: identifier },
                { email: identifier },
                { userLogin: identifier }
            ]
        });
    }

    // 3. Try finding by phoneFallback
    if (!user && phoneFallback) {
        const cleanPhone = phoneFallback.trim();
        user = await User.findOne({
            $or: [
                { phone: cleanPhone },
                { phone: cleanPhone.replace("+91", "") },
                { phone: "+91" + cleanPhone.replace("+91", "") }
            ]
        });
    }

    return user;
};

/**
 * GET /api/wallet/balance
 * Returns current wallet balance.
 */
router.get("/balance", async (req, res) => {
    try {
        let identifier = null;

        // Check JWT token
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const { verifyToken } = require("../utils/jwt");
                const decoded = verifyToken(authHeader.split(" ")[1]);
                identifier = decoded.userId || decoded.id || decoded._id || decoded.phone;
            } catch (err) {}
        }

        if (!identifier) {
            identifier = req.query.userId || req.query.user_id || req.query.phone || req.query.id;
        }

        const phoneFallback = req.query.phone || null;

        if (!identifier && !phoneFallback) {
            return res.status(400).json({ success: false, message: "User ID or phone number is required" });
        }

        let user = await findUserByIdentifier(identifier, phoneFallback);
        let astrologer = null;

        if (!user && identifier && mongoose.Types.ObjectId.isValid(identifier)) {
            const Astrologer = require("../models/astro.model");
            astrologer = await Astrologer.findById(identifier);
        }

        if (!user && !astrologer) {
            // Return 200 with 0 balance for guest users instead of breaking front-end
            return res.status(200).json({
                success: true,
                data: {
                    walletBalance: 0,
                    name: "Guest User"
                }
            });
        }

        if (astrologer) {
            return res.status(200).json({
                success: true,
                data: {
                    walletBalance: astrologer.walletBalance || 0,
                    name: astrologer.name || "Astrologer"
                }
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                walletBalance: user.walletBalance || 0,
                name: user.name || `${user.firstname || ""} ${user.lastname || ""}`.trim() || user.phone
            }
        });
    } catch (error) {
        console.error("GET /api/wallet/balance error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/wallet/add
 * Adds funds to user's wallet balance in MongoDB.
 * Body: { amount: Number, userId?: String, phone?: String }
 */
router.post("/add", async (req, res) => {
    try {
        let identifier = null;

        // Check JWT token
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const { verifyToken } = require("../utils/jwt");
                const decoded = verifyToken(authHeader.split(" ")[1]);
                identifier = decoded.userId || decoded.id || decoded._id || decoded.phone;
            } catch (err) {}
        }

        if (!identifier) {
            identifier = req.body.userId || req.body.user_id || req.body.phone || req.body.id;
        }

        const phoneFallback = req.body.phone || null;
        const { amount } = req.body;

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ success: false, message: "Invalid deposit amount. Must be a positive number." });
        }

        let user = await findUserByIdentifier(identifier, phoneFallback);

        // If user document does not exist yet in DB (e.g. initial onboarding), create one!
        if (!user && (phoneFallback || (identifier && identifier.includes("+")))) {
            const targetPhone = phoneFallback || identifier;
            user = await User.create({
                phone: targetPhone.startsWith("+91") ? targetPhone : "+91" + targetPhone.replace(/\D/g, ""),
                walletBalance: numericAmount
            });
        } else if (!user) {
            // Find any latest user if fallback
            user = await User.findOne().sort({ createdAt: -1 });
        }

        if (!user) {
            return res.status(404).json({ success: false, message: "User record not found in system." });
        }

        const previousBalance = user.walletBalance || 0;
        user.walletBalance = previousBalance + numericAmount;
        await user.save();

        console.log(`💰 Added ₹${numericAmount} to User ${user._id} (${user.phone}). New balance: ₹${user.walletBalance}`);

        return res.status(200).json({
            success: true,
            message: `₹${numericAmount.toFixed(2)} added to wallet successfully`,
            data: {
                previousBalance,
                addedAmount: numericAmount,
                newBalance: user.walletBalance,
                transactionId: `TXN_${Date.now()}`
            }
        });
    } catch (error) {
        console.error("POST /api/wallet/add error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/wallet/transactions
 * Returns transaction history for user or astrologer
 */
router.get("/transactions", async (req, res) => {
    try {
        let identifier = null;

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            try {
                const { verifyToken } = require("../utils/jwt");
                const decoded = verifyToken(authHeader.split(" ")[1]);
                identifier = decoded.userId || decoded.id || decoded._id || decoded.phone;
            } catch (err) {}
        }

        if (!identifier) identifier = req.query.userId || req.query.phone;
        const phoneFallback = req.query.phone || null;

        let user = await findUserByIdentifier(identifier, phoneFallback);
        let astrologer = null;

        if (!user && identifier && mongoose.Types.ObjectId.isValid(identifier)) {
            const Astrologer = require("../models/astro.model");
            astrologer = await Astrologer.findById(identifier);
        }

        if (!user && !astrologer) {
            return res.status(200).json({ success: true, count: 0, data: [] });
        }

        const VideoSession = require("../models/videoSession.model");
        const ChatSession = require("../models/chatSession.model");
        const Payment = require("../models/payment.model");

        const txns = [];

        if (astrologer) {
            const [callSessions, chatSessions] = await Promise.all([
                VideoSession.find({ astrologer: astrologer._id, status: { $in: ["COMPLETED", "ACTIVE"] } })
                    .sort({ updatedAt: -1 })
                    .limit(20)
                    .populate("user", "name firstname lastname phone")
                    .lean(),
                ChatSession.find({ astrologer: astrologer._id, status: { $in: ["COMPLETED", "ACTIVE"] } })
                    .sort({ updatedAt: -1 })
                    .limit(20)
                    .populate("user", "name firstname lastname phone")
                    .lean()
            ]);

            callSessions.forEach(s => {
                if (s.astrologerEarnings > 0) {
                    const clientName = s.user?.name || `${s.user?.firstname || ""} ${s.user?.lastname || ""}`.trim() || s.user?.phone || "Client";
                    txns.push({
                        id: String(s._id),
                        title: `${s.callType === "VIDEO" ? "Video" : "Audio"} Call with ${clientName}`,
                        date: new Date(s.updatedAt || s.endTime || s.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }),
                        amount: `+ ₹${(s.astrologerEarnings || 0).toFixed(2)}`,
                        amountClass: "text-green-600",
                        status: "Earned",
                        statusClass: "text-green-500",
                        iconBg: "bg-green-50 text-green-500",
                        iconType: s.callType === "VIDEO" ? "video" : "phone",
                        type: "credit"
                    });
                }
            });

            chatSessions.forEach(s => {
                if (s.astrologerEarnings > 0) {
                    const clientName = s.user?.name || `${s.user?.firstname || ""} ${s.user?.lastname || ""}`.trim() || s.user?.phone || "Client";
                    txns.push({
                        id: String(s._id),
                        title: `Chat with ${clientName}`,
                        date: new Date(s.updatedAt || s.endTime || s.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }),
                        amount: `+ ₹${(s.astrologerEarnings || 0).toFixed(2)}`,
                        amountClass: "text-green-600",
                        status: "Earned",
                        statusClass: "text-green-500",
                        iconBg: "bg-green-50 text-green-500",
                        iconType: "message",
                        type: "credit"
                    });
                }
            });
        } else {
            const [callSessions, chatSessions] = await Promise.all([
                VideoSession.find({ user: user._id, status: { $in: ["COMPLETED", "ACTIVE"] } })
                    .sort({ updatedAt: -1 })
                    .limit(20)
                    .populate("astrologer", "name")
                    .lean(),
                ChatSession.find({ user: user._id, status: { $in: ["COMPLETED", "ACTIVE"] } })
                    .sort({ updatedAt: -1 })
                    .limit(20)
                    .populate("astrologer", "name")
                    .lean()
            ]);

            callSessions.forEach(s => {
                if (s.totalAmountDeducted > 0) {
                    txns.push({
                        id: String(s._id),
                        title: `${s.callType === "VIDEO" ? "Video" : "Audio"} Call with ${s.astrologer?.name || "Astrologer"}`,
                        date: new Date(s.updatedAt || s.endTime || s.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }),
                        amount: `- ₹${(s.totalAmountDeducted || 0).toFixed(2)}`,
                        amountClass: "text-gray-800",
                        status: "Completed",
                        statusClass: "text-gray-400",
                        iconBg: "bg-pink-50 text-pink-500",
                        iconType: s.callType === "VIDEO" ? "video" : "phone",
                        type: "debit"
                    });
                }
            });

            chatSessions.forEach(s => {
                if (s.totalAmountDeducted > 0) {
                    txns.push({
                        id: String(s._id),
                        title: `Chat with ${s.astrologer?.name || "Astrologer"}`,
                        date: new Date(s.updatedAt || s.endTime || s.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }),
                        amount: `- ₹${(s.totalAmountDeducted || 0).toFixed(2)}`,
                        amountClass: "text-gray-800",
                        status: "Completed",
                        statusClass: "text-gray-400",
                        iconBg: "bg-pink-50 text-pink-500",
                        iconType: "message",
                        type: "debit"
                    });
                }
            });

            // Include Payment (top-up) records as credit transactions
            try {
                const payments = await Payment.find({ user: user._id }).sort({ createdAt: -1 }).limit(20).lean();
                payments.forEach(p => {
                    if (p.paymentStatus === "success") {
                        txns.push({
                            id: String(p._id),
                            title: p.appointment ? `Payment for appointment` : `Added Money`,
                            date: new Date(p.paidAt || p.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }),
                            amount: `+ ₹${(p.amount || 0).toFixed(2)}`,
                            amountClass: "text-green-600",
                            status: "Success",
                            statusClass: "text-green-500",
                            iconBg: "bg-green-50 text-green-500",
                            iconType: "wallet",
                            type: "credit",
                            meta: {
                                paymentGateway: p.paymentGateway,
                                transactionId: p.transactionId,
                                orderId: p.orderId
                            }
                        });
                    } else if (p.paymentStatus === "failed") {
                        txns.push({
                            id: String(p._id),
                            title: `Failed Payment`,
                            date: new Date(p.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }),
                            amount: `- ₹${(p.amount || 0).toFixed(2)}`,
                            amountClass: "text-gray-800",
                            status: "Failed",
                            statusClass: "text-red-500",
                            iconBg: "bg-gray-50 text-gray-400",
                            iconType: "alert",
                            type: "failed",
                            meta: {
                                paymentGateway: p.paymentGateway,
                                transactionId: p.transactionId,
                                orderId: p.orderId
                            }
                        });
                    }
                });
            } catch (e) {
                console.warn("Could not load payments for transactions view:", e.message);
            }
        }

        txns.sort((a, b) => new Date(b.date) - new Date(a.date));

        return res.status(200).json({
            success: true,
            count: txns.length,
            data: txns
        });
    } catch (error) {
        console.error("GET /api/wallet/transactions error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
