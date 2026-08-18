const Payment = require("../models/payment.model");
const User = require("../models/user.model");
const Appointment = require("../models/appointment.model");

const createPayment = async (paymentData) => {

    // Check User
    const user = await User.findById(paymentData.user);

    if (!user) {
        throw new Error("User not found");
    }

    // Check Appointment
    const appointment = await Appointment.findById(paymentData.appointment);

    if (!appointment) {
        throw new Error("Appointment not found");
    }

    // Check Existing Payment
    const existingPayment = await Payment.findOne({
        appointment: paymentData.appointment
    });

    if (existingPayment) {
        throw new Error("Payment already exists for this appointment");
    }

    return await Payment.create(paymentData);
};

const getAllPayments = async () => {
    return await Payment.find()
        .populate("user")
        .populate("appointment");
};

const getPaymentById = async (id) => {
    return await Payment.findById(id)
        .populate("user")
        .populate("appointment");
};

const getPaymentByTransactionId = async (txId) => {
    return await Payment.findOne({
        $or: [ { transactionId: txId }, { orderId: txId }, { _id: txId } ]
    })
    .populate("user")
    .populate("appointment");
};

const updatePayment = async (id, updateData) => {

    const payment = await Payment.findByIdAndUpdate(
        id,
        updateData,
        {
            new: true,
            runValidators: true
        }
    );

    // If payment is successful, confirm appointment
    if (payment && payment.paymentStatus === "success") {

        await Appointment.findByIdAndUpdate(
            payment.appointment,
            {
                appointmentStatus: "confirmed",
                paymentStatus: "paid"
            }
        );
    }

    return payment;
};

const deletePayment = async (id) => {
    return await Payment.findByIdAndDelete(id);
};

module.exports = {
    createPayment,
    getAllPayments,
    getPaymentById,
    getPaymentByTransactionId,
    updatePayment,
    deletePayment
};