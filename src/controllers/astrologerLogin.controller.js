const AstrologerLogin = require("../models/astrologerLogin.model");
const Astrologer = require("../models/astro.model");
const AstroInterview = require("../models/astroInterview.model");
const Otp = require("../models/otp.model");
const fast2smsService = require("../services/fast2sms.service");
const astroInterviewService = require("../services/astroInterview.service");
const bcrypt = require("bcrypt");
const { generateToken } = require("../utils/jwt");

// 1. REGISTER ASTROLOGER
exports.createAstrologerLogin = async (req, res) => {
    try {
        const body = req.body || {};
        const { name, email, password } = body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        // Check if email already registered
        const existingAstrologer = await Astrologer.findOne({ email: email.toLowerCase() });

        if (existingAstrologer) {
            return res.status(400).json({
                success: false,
                message: "Email already registered"
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Extract optional profile fields if provided during signup
        const profileImage = body.profilePhoto || body.profileImage || null;
        const introduction = body.introduction || body.about || null;
        const about = body.introduction || body.about || null;
        const experience = body.experience ? String(body.experience) : "0";
        const strengths = body.selectedStrengths || body.strengths || [];
        const specialization = body.selectedSpecializations || body.specialization || [];
        const languages = body.languages || [];
        const approach = body.approach || null;
        const motivation = body.motivation || null;
        const toolsTechniques = body.toolsTechniques || null;
        const certificateFile = body.certificateFile || null;
        const certificateName = body.certificateName || null;
        const achievements = body.achievements || null;

        // Save Astrologer record
        const astrologer = await Astrologer.create({
            name: name || body.fullName || body.astrologerName || null,
            email: email.toLowerCase(),
            password: hashedPassword,
            profileImage,
            introduction,
            about,
            experience,
            strengths,
            specialization,
            languages,
            approach,
            motivation,
            toolsTechniques,
            certificateFile,
            certificateName,
            achievements,
            isAvailable: true,
            status: "pending"
        });

        // Automatically Request/Create Interview record on successful signup
        try {
            await astroInterviewService.requestInterview(astrologer._id, "Auto-created on signup registration");
        } catch (interviewErr) {
            console.error("Failed to automatically create interview request on registration:", interviewErr.message);
        }

        // Generate JWT token
        const token = generateToken({
            userId: astrologer._id,
            role: "astrologer"
        });

        return res.status(201).json({
            success: true,
            message: "Astrologer registered successfully",
            token,
            astrologer
        });

    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};

exports.loginAstrologer = async (req, res) => {
    try {
        const body = req.body || {};
        const identifier = body.email || body.phone || body.identifier;
        const password = body.password;

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: "Email or phone and password are required"
            });
        }

        const isEmail = typeof identifier === "string" && identifier.includes("@");
        const query = isEmail
            ? { email: identifier.toLowerCase() }
            : { $or: [{ phone: identifier }, { email: String(identifier).toLowerCase() }] };

        // Find registered astrologer by email or phone
        const astrologer = await Astrologer.findOne(query);

        if (!astrologer || !astrologer.password) {
            return res.status(401).json({
                success: false,
                message: "Invalid credentials. Account not found."
            });
        }

        // Verify bcrypt password
        const isPasswordValid = await bcrypt.compare(password, astrologer.password);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: "Invalid credentials."
            });
        }

        // Check Admin Approval Status
        if (astrologer.status === "rejected") {
            return res.status(403).json({
                success: false,
                message: "Your registration request has been rejected by Admin."
            });
        }


        // Save login timestamp & audit record in AstrologerLogin
        try {
            const loginRecord = await AstrologerLogin.create({
                astrologer: astrologer._id,
                name: astrologer.name,
                email: astrologer.email,
                password: astrologer.password,
                lastLoginAt: new Date()
            });

            astrologer.astrologerLogin = loginRecord._id;
            await astrologer.save();
        } catch (e) {}

        // Generate JWT token
        const token = generateToken({
            userId: astrologer._id,
            role: "astrologer"
        });

        return res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            astrologer
        });

    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Server Error"
        });
    }
};

// 3. FORGOT PASSWORD - SEND OTP (Email & Twilio SMS)
exports.forgotPasswordSendOtp = async (req, res) => {
    try {
        const identifier = req.body.email || req.body.phone || req.body.identifier;

        if (!identifier) {
            return res.status(400).json({
                success: false,
                message: "Email or phone number is required"
            });
        }

        const isEmailInput = identifier.includes("@");
        const query = isEmailInput
            ? { email: identifier.toLowerCase() }
            : { phone: identifier };

        const astrologer = await Astrologer.findOne(query);

        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: "Astrologer account not found with this email/phone"
            });
        }

        const targetEmail = (astrologer && astrologer.email) ? astrologer.email.toLowerCase() : (isEmailInput ? identifier.toLowerCase() : null);
        const targetPhone = (astrologer && astrologer.phone) ? astrologer.phone : (!isEmailInput ? identifier : null);
        const customOtp = Math.floor(100000 + Math.random() * 900000).toString();

        // Save OTP in DB for phone if available
        if (targetPhone) {
            await Otp.deleteMany({ phone: targetPhone });
            await Otp.create({ phone: targetPhone, otp: customOtp });
        }

        // Save OTP in DB for email if available
        if (targetEmail) {
            await Otp.deleteMany({ phone: targetEmail.toLowerCase() });
            await Otp.create({ phone: targetEmail.toLowerCase(), otp: customOtp });
        }

        let smsResult = null;

        // Send SMS via Fast2SMS if phone is available
        if (targetPhone) {
            try {
                smsResult = await fast2smsService.sendOtp(targetPhone, customOtp);
            } catch (err) {
                console.warn("Fast2SMS send error:", err.message);
            }
        }

        return res.status(200).json({
            success: true,
            message: "OTP sent successfully to registered email/phone",
            data: {
                targetEmail,
                targetPhone,
                otp: customOtp,
                smsStatus: smsResult,
                emailStatus: emailResult
            }
        });

    } catch (error) {
        console.error("Forgot Password Send OTP Error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Server Error"
        });
    }
};

// 4. FORGOT PASSWORD - RESET PASSWORD
exports.forgotPasswordReset = async (req, res) => {
    try {
        const identifier = req.body.email || req.body.phone || req.body.identifier;
        const { otp, newPassword } = req.body;

        if (!identifier || !otp || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Email/Phone, OTP code, and new password are required"
            });
        }

        if (newPassword.length < 4) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 4 characters long"
            });
        }

        const query = identifier.includes("@")
            ? { email: identifier.toLowerCase() }
            : { phone: identifier };

        const astrologer = await Astrologer.findOne(query);

        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: "Astrologer account not found"
            });
        }

        const targetPhone = astrologer.phone || identifier;

        let isVerified = false;

        // Check local DB Otp model (phone or email key)
        const existingOtp = await Otp.findOne({
            $or: [
                { phone: targetPhone, otp },
                { phone: targetEmail, otp }
            ]
        });

        if (existingOtp) {
            isVerified = true;
        }

        if (!isVerified) {
            return res.status(400).json({
                success: false,
                message: "Invalid or expired OTP"
            });
        }

        // Clean up OTP record
        await Otp.deleteMany({ phone: targetPhone });

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password in Astrologer model
        astrologer.password = hashedPassword;
        await astrologer.save();

        // Update password in AstrologerLogin audit model if email exists
        if (astrologer.email) {
            try {
                await AstrologerLogin.updateMany(
                    { email: astrologer.email.toLowerCase() },
                    { $set: { password: hashedPassword } }
                );
            } catch (e) {}
        }

        return res.status(200).json({
            success: true,
            message: "Password reset successfully. You can now login with your new password."
        });

    } catch (error) {
        console.error("Forgot Password Reset Error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Server Error"
        });
    }
};

// 5. CHECK APPROVAL & INTERVIEW STATUS (For frontend polling)
exports.getApprovalStatus = async (req, res) => {
    try {
        let astrologerId = null;

        // Extract from auth token
        if (req.user && req.user.userId) {
            astrologerId = req.user.userId;
        }

        if (!astrologerId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized. Token missing or invalid."
            });
        }

        const astrologer = await Astrologer.findById(astrologerId);
        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: "Astrologer profile not found"
            });
        }

        // Fetch corresponding interview session
        const interview = await AstroInterview.findOne({ astrologer: astrologerId });

        // Build standard structure to match checkApprovalStatusApi expected values
        let responseData = {
            success: true,
            status: astrologer.status,        // "pending" | "approved" | "rejected"
            isApproved: astrologer.status === "approved",
            interviewStatus: interview ? interview.status : "not_requested",
            // "requested" | "scheduled" | "passed" | "failed" | "cancelled" | "not_requested"
            date: null,
            time: null,
            interviewDate: null,
            meetingLink: null,
            link: null,          // alias for meetingLink
            agoraAppId: process.env.AGORA_APP_ID || "MOCK_AGORA_APP_ID",
            agoraChannel: null,
            agoraToken: null,    // astrologer's Agora RTC token
            agoraUid: 2,         // astrologer UID in channel
            note: interview ? (interview.interviewerNotes || interview.requestNotes) : null
        };

        if (interview && interview.interviewDate) {
            responseData.interviewDate = interview.interviewDate;
            const d = new Date(interview.interviewDate);
            responseData.date = d.toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric"
            });
            responseData.time = d.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                hour12: true
            });
            responseData.meetingLink = interview.meetingLink || null;
            responseData.link        = interview.meetingLink || null;
            responseData.agoraChannel = interview.agoraChannel || null;
            // The astrologer-specific Agora token & UID
            responseData.agoraToken = interview.agoraAstrologerToken || null;
            responseData.agoraUid   = interview.agoraAstrologerUid  || 2;
        }

        return res.status(200).json(responseData);

    } catch (error) {
        console.error("Get Approval Status Error:", error);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
};