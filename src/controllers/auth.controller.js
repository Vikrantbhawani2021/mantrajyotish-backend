const authService = require("../services/auth.service");

const sendOtp = async (req, res, next) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        const result = await authService.sendOtp(phone);

        return res.status(200).json({
            success: true,
            message: result.message || "OTP sent successfully",
            data: result
        });

     } catch (error) {
        next(error);
    }
};

const verifyOtp = async (req, res, next) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({
                success: false,
                message: "Phone number and OTP code are required"
            });
        }

        const data = await authService.verifyOtp(phone, otp);

        return res.status(200).json({
            success: true,
            message: "OTP verified successfully",
            data
        });

     } catch (error) {
        next(error);
    }
};

const refresh = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: "Refresh token is required"
            });
        }

        const data = await authService.refresh(refreshToken);

        return res.status(200).json({
            success: true,
            message: "Token refreshed successfully",
            data
        });
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: error.message || "Invalid refresh token"
        });
    }
};

module.exports = {
    sendOtp,
    verifyOtp,
    refresh
};