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

// POST /api/razorpay/order
const createOrder = async (req, res) => {
    try {
        const { amount, currency, receipt, payment_capture } = req.body;

        if (!amount || Number(amount) <= 0) {
            return res.status(400).json({ success: false, message: "Invalid amount" });
        }

        const order = await razorpayService.createOrder({ amount, currency, receipt, payment_capture });

        // Persist a Payment record (pending) so we can reconcile later.
        // Accept optional userId and appointmentId from client
        const userId = req.body.userId || req.body.user_id || null;
        const appointmentId = req.body.appointmentId || req.body.appointment || null;

        const paymentData = {
            amount: Number(amount),
            currency: currency || "INR",
            paymentGateway: "Razorpay",
            paymentStatus: "pending",
            orderId: order.id
        };

        if (userId && mongoose.Types.ObjectId.isValid(userId)) paymentData.user = userId;
        if (appointmentId && mongoose.Types.ObjectId.isValid(appointmentId)) paymentData.appointment = appointmentId;

        let paymentRecord = null;
        try {
            paymentRecord = await Payment.create(paymentData);
        } catch (e) {
            // Log but don't fail order creation
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

        // Update Payment record if exists
        let payment = await Payment.findOne({ orderId: razorpay_order_id });
        if (!payment) {
            // try to find by transactionId
            payment = await Payment.findOne({ transactionId: razorpay_payment_id });
        }

        if (payment) {
            payment.paymentStatus = "success";
            payment.transactionId = razorpay_payment_id;
            payment.paidAt = new Date();
            await payment.save();

            // If this payment is for an appointment, mark appointment as paid/confirmed
            if (payment.appointment) {
                try {
                    await Appointment.findByIdAndUpdate(payment.appointment, { appointmentStatus: "confirmed", paymentStatus: "paid" });
                } catch (e) {
                    console.warn("Could not update appointment status:", e.message);
                }
            } else if (payment.user) {
                // Wallet top-up flow: credit user's wallet
                try {
                    const user = await User.findById(payment.user);
                    if (user) {
                        user.walletBalance = (user.walletBalance || 0) + Number(payment.amount);
                        await user.save();
                    }
                } catch (e) {
                    console.warn("Could not credit user wallet:", e.message);
                }
            }
        }

        return res.status(200).json({ success: true, message: "Payment verified successfully", data: { razorpay_order_id, razorpay_payment_id, paymentId: payment?._id || null } });
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
                        payment.paymentStatus = "success";
                        payment.transactionId = paymentId;
                        payment.paidAt = new Date();
                        await payment.save();

                        if (payment.appointment) {
                            await Appointment.findByIdAndUpdate(payment.appointment, { appointmentStatus: "confirmed", paymentStatus: "paid" });
                        } else if (payment.user) {
                            const user = await User.findById(payment.user);
                            if (user) {
                                user.walletBalance = (user.walletBalance || 0) + Number(payment.amount);
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
