const Razorpay = require("razorpay");
const config = require("../config/config");
const crypto = require("crypto");

const instance = new Razorpay({
    key_id: config.razorpay.keyId,
    key_secret: config.razorpay.keySecret
});

const createOrder = async ({ amount, currency = "INR", receipt = null, payment_capture = 1 } = {}) => {
    if (!amount || Number(amount) <= 0) throw new Error("Invalid amount");

    // Razorpay expects amount in paise
    const amountInPaise = Math.round(Number(amount) * 100);

    const options = {
        amount: amountInPaise,
        currency,
        payment_capture: payment_capture,
    };

    if (receipt) options.receipt = receipt;

    const order = await instance.orders.create(options);
    return order;
};

const verifyPaymentSignature = ({ order_id, payment_id, signature }) => {
    const generated_signature = crypto.createHmac('sha256', config.razorpay.keySecret)
        .update(`${order_id}|${payment_id}`)
        .digest('hex');

    return generated_signature === signature;
};

const fetchPayment = async (payment_id) => {
    if (!payment_id) throw new Error('payment_id is required');
    const payment = await instance.payments.fetch(payment_id);
    return payment;
};

const verifyWebhookSignature = ({ payload, signature }) => {
    const generated = crypto.createHmac('sha256', config.razorpay.keySecret)
        .update(payload)
        .digest('hex');

    return generated === signature;
};

module.exports = {
    createOrder,
    verifyPaymentSignature,
    verifyWebhookSignature,
    fetchPayment
};
