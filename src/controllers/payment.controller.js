const paymentService = require("../services/payment.service");

const createPayment = async (req, res) => {
    try {

        const payment = await paymentService.createPayment(req.body);

        return res.status(201).json({
            success: true,
            message: "Payment Created Successfully",
            data: payment
        });

    } catch (error) {

        return res.status(400).json({
            success: false,
            message: error.message
        });

    }
};

const getAllPayments = async (req, res) => {
    try {

        const payments = await paymentService.getAllPayments();

        return res.status(200).json({
            success: true,
            count: payments.length,
            data: payments
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

const getPaymentById = async (req, res) => {
    try {

        const payment = await paymentService.getPaymentById(req.params.id);

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: "Payment Not Found"
            });
        }

        return res.status(200).json({
            success: true,
            data: payment
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

const updatePayment = async (req, res) => {
    try {

        const payment = await paymentService.updatePayment(
            req.params.id,
            req.body
        );

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: "Payment Not Found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Payment Updated Successfully",
            data: payment
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

const deletePayment = async (req, res) => {
    try {

        const payment = await paymentService.deletePayment(req.params.id);

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: "Payment Not Found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Payment Deleted Successfully"
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });

    }
};

const getPaymentByTransactionId = async (req, res) => {
    try {
        const id = req.params.id;
        const payment = await paymentService.getPaymentByTransactionId(id);

        if (!payment) {
            return res.status(404).json({ success: false, message: "Payment Not Found" });
        }

        return res.status(200).json({ success: true, data: payment });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createPayment,
    getAllPayments,
    getPaymentById,
    updatePayment,
    deletePayment,
    getPaymentByTransactionId
};