const razorpayService = require("../services/razorpay.service");
const User = require("../models/user.model");
const Payment = require("../models/payment.model");
const Appointment = require("../models/appointment.model");
const mongoose = require("mongoose");

/** Helper: find user by id/phone/uniqueId/email */
const findUserByIdentifier = async (identifier, phoneFallback = null) => {
    if (!identifier && !phoneFallback) return null;

    let user = null;

    if (identifier && mongoose.Types.ObjectId.isValid(identifier)) {
        user = await User.findById(identifier);
    }

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

/** Shared helper to robustly resolve user from request headers or body */
const resolveUserFromRequest = async (req) => {
    let identifier = null;

    // 1. Try finding via Authorization JWT token
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
        try {
            const { verifyToken } = require("../utils/jwt");
            const decoded = verifyToken(req.headers.authorization.split(" ")[1]);
            identifier = decoded.userId || decoded.id || decoded._id || decoded.phone || null;
        } catch (e) {
            // Ignore token verification errors (e.g. expired tokens)
        }
    }

    // 2. Fallback to request body parameters
    if (!identifier) {
        identifier = req.body.userId || req.body.user_id || req.body.phone || req.body.id || null;
    }

    const phoneFallback = req.body.phone || null;
    if (!identifier && !phoneFallback) return null;

    return await findUserByIdentifier(identifier, phoneFallback);
};

// POST /api/razorpay/order
const createOrder = async (req, res) => {
    try {
        const { amount, currency, receipt, payment_capture } = req.body;

        if (!amount || Number(amount) <= 0) {
            return res.status(400).json({ success: false, message: "Invalid amount" });
        }

        // Robustly resolve user
        const user = await resolveUserFromRequest(req);
        if (!user) {
            return res.status(401).json({ success: false, message: "Authentication required or user not found" });
        }

        const order = await razorpayService.createOrder({ amount, currency, receipt, payment_capture });

        // Persist a Payment record (pending) so we can reconcile later.
        const appointmentId = req.body.appointmentId || req.body.appointment || null;

        const paymentData = {
            user: user._id,
            amount: Number(amount),
            currency: currency || "INR",
            paymentGateway: "Razorpay",
            paymentStatus: "pending",
            orderId: order.id
        };

        if (appointmentId && mongoose.Types.ObjectId.isValid(appointmentId)) paymentData.appointment = appointmentId;

        let paymentRecord = null;
        try {
            paymentRecord = await Payment.create(paymentData);
        } catch (e) {
            console.warn("Could not create payment record:", e.message);
        }

        return res.status(201).json({ success: true, data: { order, keyId: process.env.RAZORPAY_KEY_ID || null, payment: paymentRecord } });
    } catch (error) {
        console.error("createOrder error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/razorpay/verify
const verifyPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: "Missing payment verification fields" });
        }

        const valid = razorpayService.verifyPaymentSignature({ order_id: razorpay_order_id, payment_id: razorpay_payment_id, signature: razorpay_signature });

        if (!valid) {
            return res.status(400).json({ success: false, message: "Invalid signature" });
        }

        // Fetch payment details from Razorpay to get authoritative amount (in paise)
        let paymentEntity = null;
        try {
            paymentEntity = await razorpayService.fetchPayment(razorpay_payment_id);
        } catch (e) {
            console.warn("Could not fetch payment entity from Razorpay:", e.message);
        }

        // Determine credited amount in rupees. Prefer server-side paymentEntity amount.
        let creditedAmount = null;
        if (paymentEntity && paymentEntity.amount) {
            creditedAmount = Number(paymentEntity.amount) / 100; // paise -> rupees
        } else if (amount) {
            creditedAmount = Number(amount);
        }

        // Update Payment record if exists
        let payment = await Payment.findOne({ orderId: razorpay_order_id });
        if (!payment) {
            payment = await Payment.findOne({ transactionId: razorpay_payment_id });
        }

        // Robustly resolve user
        const resolvedUser = await resolveUserFromRequest(req);

        // Track if already successful to prevent double-crediting
        const alreadySuccess = payment && payment.paymentStatus === "success";

        if (!payment) {
            if (!resolvedUser) {
                return res.status(400).json({ success: false, message: "Could not resolve user to associate with payment" });
            }

            // If no payment record exists, create one (capture case where client didn't create a payment record)
            const newPaymentData = {
                user: resolvedUser._id,
                amount: creditedAmount != null ? creditedAmount : (amount ? Number(amount) : 0),
                currency: req.body.currency || (paymentEntity ? paymentEntity.currency : "INR"),
                paymentGateway: "Razorpay",
                paymentStatus: "success",
                orderId: razorpay_order_id,
                transactionId: razorpay_payment_id,
                paidAt: new Date()
            };

            try {
                payment = await Payment.create(newPaymentData);
            } catch (e) {
                console.warn("Could not create payment record on verify:", e.message);
                return res.status(500).json({ success: false, message: "Could not save payment record: " + e.message });
            }
        } else {
            // Update fields
            payment.paymentStatus = "success";
            payment.transactionId = razorpay_payment_id;
            payment.paidAt = payment.paidAt || new Date();
            if (!payment.user && resolvedUser) {
                payment.user = resolvedUser._id;
            }
            if (creditedAmount != null) {
                payment.amount = creditedAmount;
            }
            await payment.save();
        }

        // Now perform follow-up actions (only if NOT already marked as success to prevent double crediting/actions)
        if (payment && !alreadySuccess) {
            if (payment.appointment) {
                try {
                    await Appointment.findByIdAndUpdate(payment.appointment, { appointmentStatus: "confirmed", paymentStatus: "paid" });
                } catch (e) {
                    console.warn("Could not update appointment status:", e.message);
                }
            } else if (payment.user) {
                // Wallet top-up flow: credit user's wallet if payment.user present and NOT appointment payment
                try {
                    const user = await User.findById(payment.user);
                    if (user) {
                        const toAdd = creditedAmount != null ? creditedAmount : Number(payment.amount);
                        console.log(`Crediting user ${user._id} wallet with amount:`, toAdd);
                        user.walletBalance = (user.walletBalance || 0) + toAdd;
                        await user.save();
                    }
                } catch (e) {
                    console.warn("Could not credit user wallet:", e.message);
                }
            }
        }

        return res.status(200).json({
            success: true,
            message: "Payment verified successfully",
            data: {
                razorpay_order_id,
                razorpay_payment_id,
                paymentId: payment?._id || null,
                addedAmount: creditedAmount != null ? creditedAmount : (payment ? Number(payment.amount) : null),
                redirect: "/wallet"
            }
        });
    } catch (error) {
        console.error("verifyPayment error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/razorpay/webhook
const webhookHandler = async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        // Obtain raw payload string. When using express.raw the body may be a Buffer.
        let payload;
        if (req.rawBody && typeof req.rawBody === 'string') {
            payload = req.rawBody;
        } else if (Buffer.isBuffer(req.body)) {
            payload = req.body.toString();
        } else {
            payload = JSON.stringify(req.body);
        }

        const valid = razorpayService.verifyWebhookSignature({ payload, signature });

        if (!valid) {
            console.warn("Invalid webhook signature");
            return res.status(400).send('invalid signature');
        }

        const event = req.body.event;
        const payloadData = req.body.payload || {};

        // Example: payment captured
        if (event === "payment.captured") {
            const paymentEntity = payloadData.payment && payloadData.payment.entity ? payloadData.payment.entity : null;
            if (paymentEntity) {
                const orderId = paymentEntity.order_id || null;
                const paymentId = paymentEntity.id || null;
                try {
                    let payment = null;
                    if (orderId) payment = await Payment.findOne({ orderId });
                    if (!payment && paymentId) payment = await Payment.findOne({ transactionId: paymentId });

                    if (payment) {
                        // Prevent double-crediting if already success
                        if (payment.paymentStatus === "success") {
                            console.log(`Webhook: Payment ${payment._id} already marked success. Skipping wallet credit.`);
                            return res.status(200).json({ success: true, message: "Already processed" });
                        }

                        payment.paymentStatus = "success";
                        payment.transactionId = paymentId;
                        payment.paidAt = payment.paidAt || new Date();
                        await payment.save();

                        if (payment.appointment) {
                            await Appointment.findByIdAndUpdate(payment.appointment, { appointmentStatus: "confirmed", paymentStatus: "paid" });
                        } else if (payment.user) {
                            const user = await User.findById(payment.user);
                            if (user) {
                                const toAdd = (paymentEntity && paymentEntity.amount) ? (Number(paymentEntity.amount) / 100) : Number(payment.amount);
                                console.log(`Webhook: crediting user ${user._id} wallet with amount:`, toAdd);
                                user.walletBalance = (user.walletBalance || 0) + toAdd;
                                await user.save();
                            }
                        }
                    }
                } catch (e) {
                    console.error("Error processing webhook payment.captured:", e);
                }
            }
        }

        // Handle payment.failed
        if (event === "payment.failed") {
            const paymentEntity = payloadData.payment && payloadData.payment.entity ? payloadData.payment.entity : null;
            if (paymentEntity) {
                const orderId = paymentEntity.order_id || null;
                const paymentId = paymentEntity.id || null;
                try {
                    let payment = null;
                    if (orderId) payment = await Payment.findOne({ orderId });
                    if (!payment && paymentId) payment = await Payment.findOne({ transactionId: paymentId });
                    if (payment) {
                        // Skip if already success
                        if (payment.paymentStatus === "success") {
                            console.log(`Webhook: Payment ${payment._id} already marked success. Ignoring fail webhook.`);
                            return res.status(200).json({ success: true });
                        }
                        payment.paymentStatus = "failed";
                        payment.transactionId = paymentId;
                        await payment.save();
                    }
                } catch (e) {
                    console.error("Error processing webhook payment.failed:", e);
                }
            }
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("webhookHandler error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createOrder,
    verifyPayment,
    webhookHandler
};

