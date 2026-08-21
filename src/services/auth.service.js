const User = require("../models/user.model");
const UserLogin = require("../models/userLogin.model");
const Otp = require("../models/otp.model");
const fast2smsService = require("./fast2sms.service");
const { generateToken, generateRefreshToken, verifyRefreshToken } = require("../utils/jwt");

/**
 * Send OTP via Fast2SMS
 * @param {string} phone - User phone number
 */
const sendOtp = async (phone) => {
    const min = 100000;
    const max = 999999;
    const customOtp = Math.floor(Math.random() * (max - min + 1)) + min;

    // Save/update OTP record in database
    await Otp.findOneAndUpdate(
        { phone },
        { phone, otp: customOtp, expiresAt: new Date(Date.now() + 10 * 60 * 1000) }, // 10 minutes expiry
        { upsert: true, new: true }
    );

    // Trigger Fast2SMS service
    const result = await fast2smsService.sendOtp(phone, customOtp);
    if (!result.success) {
        throw new Error(result.message || "Failed to deliver OTP via Fast2SMS");
    }

    return {
        success: true,
        message: "OTP sent successfully"
    };
};

/**
 * Verify OTP and login/register user
 * @param {string} phone - User phone number
 * @param {string} otp - Entered OTP
 */
const verifyOtp = async (phone, otp) => {
    let user;
    if (phone === "+918979689005" && otp === "123456") {
        // Developer OTP bypass
        user = await User.findOne({ phone });
        if (!user) {
            user = await User.create({
                phone,
                role: "user",
                isProfileCompleted: false
            });
        }
    } else {
        // Find valid OTP record
        const otpRecord = await Otp.findOne({ phone, otp });
        if (!otpRecord) {
            throw new Error("Invalid OTP");
        }

        // Check expiry
        if (otpRecord.expiresAt < new Date()) {
            throw new Error("OTP has expired");
        }

        // Delete OTP record after successful use
        await Otp.deleteOne({ _id: otpRecord._id });

        // Check if user exists, otherwise create
        user = await User.findOne({ phone });
        if (!user) {
            user = await User.create({
                phone,
                role: "user",
                isProfileCompleted: false
            });
        }
    }

    // Record login entry in UserLogin model
    try {
        const userLoginRecord = await UserLogin.create({
            user: user._id,
            phone: user.phone,
            email: user.email || null,
            loginMethod: "otp",
            lastLoginAt: new Date()
        });

        user.userLogin = userLoginRecord._id;
        await user.save();
    } catch (e) {
        console.warn("UserLogin audit log warning:", e.message);
    }

    // Generate JWT token
    const token = generateToken({
        userId: user._id,
        role: user.role
    });
    const refreshToken = generateRefreshToken({
        userId: user._id,
        role: user.role
    });

    return {
        user,
        token,
        refreshToken
    };
};

/**
 * Refresh access token using refresh token
 * @param {string} tokenStr - Refresh token
 */
const refresh = async (tokenStr) => {
    try {
        const decoded = verifyRefreshToken(tokenStr);
        if (!decoded || !decoded.userId) {
            throw new Error("Invalid token payload");
        }

        const user = await User.findById(decoded.userId);
        if (!user) {
            throw new Error("User not found");
        }

        const token = generateToken({
            userId: user._id,
            role: user.role
        });
        const refreshToken = generateRefreshToken({
            userId: user._id,
            role: user.role
        });

        return {
            token,
            refreshToken
        };
    } catch (error) {
        throw new Error(error.message || "Failed to refresh token");
    }
};

module.exports = {
    sendOtp,
    verifyOtp,
    refresh
};