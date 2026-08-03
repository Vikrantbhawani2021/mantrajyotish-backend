const { verifyTuloToken } = require("../config/tulo");
const User = require("../models/user.model");
const UserLogin = require("../models/userLogin.model");
const Otp = require("../models/otp.model");
const fast2smsService = require("./fast2sms.service");
const { generateToken } = require("../utils/jwt");

/**
 * Legacy/Tulo login handler
 */
const login = async (tuloToken) => {
    // Verify Tulo Token
    const { tuloId, phone } = await verifyTuloToken(tuloToken);

    // Find Existing User by tuloId or phone
    let user = await User.findOne({
        $or: [
            { tuloId },
            ...(phone ? [{ phone }] : [])
        ]
    });

    // Create User if not found
    if (!user) {
        user = await User.create({
            tuloId,
            phone: phone || `+0000000000_${tuloId}`,
            role: "user",
            isProfileCompleted: false
        });
    } else if (!user.tuloId) {
        // Link tuloId if user previously existed by phone
        user.tuloId = tuloId;
        await user.save();
    }

    // Record login entry in UserLogin model
    try {
        const userLoginRecord = await UserLogin.create({
            user: user._id,
            phone: user.phone,
            email: user.email || null,
            tuloId: user.tuloId || tuloId,
            loginMethod: "tulo",
            lastLoginAt: new Date()
        });

        user.userLogin = userLoginRecord._id;
        await user.save();
    } catch (e) {
        console.warn("UserLogin audit log warning:", e.message);
    }

    // Generate Backend JWT
    const token = generateToken({
        userId: user._id,
        role: user.role
    });

    return {
        user,
        token
    };
};

/**
 * Send OTP via Fast2SMS
 * @param {string} phone - User phone number
 */
const sendOtp = async (phone) => {
    if (!phone) {
        const error = new Error("Phone number is required");
        error.status = 400;
        throw error;
    }

    // Generate custom 6 digit OTP
    const customOtp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store/Update OTP in DB for local verification
    await Otp.deleteMany({ phone }); // Remove previous OTPs for this phone
    await Otp.create({
        phone,
        otp: customOtp
    });

    // Trigger Fast2SMS service
    const result = await fast2smsService.sendOtp(phone, customOtp);
    return result;
};

/**
 * Verify OTP and authenticate user
 * @param {string} phone - User phone number
 * @param {string} otp - OTP code entered by user
 */
const verifyOtp = async (phone, otp) => {
    if (!phone || !otp) {
        const error = new Error("Phone number and OTP code are required");
        error.status = 400;
        throw error;
    }

    let isVerified = false;

    // 1. Check for development mock OTP
    if (otp === "123456") {
        isVerified = true;
    } else {
        // 2. Check local DB Otp model
        const existingOtp = await Otp.findOne({ phone, otp });
        if (existingOtp) {
            isVerified = true;
        }
    }

    if (!isVerified) {
        const error = new Error("Invalid or expired OTP");
        error.status = 400;
        throw error;
    }

    // Clean up OTP record from DB
    await Otp.deleteMany({ phone });

    // Find or create User
    let user = await User.findOne({ phone });
    if (!user) {
        user = await User.create({
            phone,
            role: "user",
            isProfileCompleted: false
        });
    }

    // Record login entry in UserLogin model
    try {
        const userLoginRecord = await UserLogin.create({
            user: user._id,
            phone: user.phone,
            email: user.email || null,
            tuloId: user.tuloId || null,
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

    return {
        user,
        token
    };
};

module.exports = {
    login,
    sendOtp,
    verifyOtp
};