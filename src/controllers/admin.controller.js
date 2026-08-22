const adminService = require("../services/admin.service");

// 1. REGISTER / CREATE ADMIN
const registerAdmin = async (req, res, next) => {
    try {
        const result = await adminService.createAdmin(req.body);

        return res.status(201).json({
            success: true,
            message: "Admin account registered successfully",
            data: result
        });

    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// 2. LOGIN ADMIN
const loginAdmin = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const result = await adminService.loginAdmin(email, password);

        return res.status(200).json({
            success: true,
            message: "Admin login successful",
            data: result
        });

    } catch (error) {
        return res.status(401).json({
            success: false,
            message: error.message
        });
    }
};

// 3. GET LOGGED-IN ADMIN PROFILE
const getProfile = async (req, res, next) => {
    try {
        const adminId = req.user.userId;
        const admin = await adminService.getAdminById(adminId);

        return res.status(200).json({
            success: true,
            data: admin
        });

    } catch (error) {
        return res.status(404).json({
            success: false,
            message: error.message
        });
    }
};

const Astrologer = require("../models/astro.model");
const AstrologerLogin = require("../models/astrologerLogin.model");

// GET all astrologers
const getAstrologers = async (req, res) => {
    try {
        const list = await Astrologer.find()
            .populate("user", "name phone email")
            .populate("astrologerLogin")
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: list.length,
            data: list
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// GET astrologer by ID
const getAstrologerById = async (req, res) => {
    try {
        const astrologer = await Astrologer.findById(req.params.id)
            .populate("user", "name phone email")
            .populate("astrologerLogin");

        if (!astrologer) {
            return res.status(404).json({ success: false, message: "Astrologer not found" });
        }

        return res.status(200).json({
            success: true,
            data: astrologer
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// UPDATE astrologer details
const updateAstrologer = async (req, res) => {
    try {
        const body = req.body || {};
        
        // Find existing
        const astrologer = await Astrologer.findById(req.params.id);
        if (!astrologer) {
            return res.status(404).json({ success: false, message: "Astrologer not found" });
        }

        // Extract and update fields dynamically
        const fields = [
            "name", "email", "phone", "profileImage", "introduction", "about",
            "experience", "strengths", "specialization", "languages", "approach",
            "motivation", "toolsTechniques", "certificateFile", "certificateName",
            "achievements", "consultationFee", "chatPrice", "audioCallPrice",
            "videoCallPrice", "status", "isVerified", "isOnline", "isAvailable"
        ];

        fields.forEach(field => {
            if (body[field] !== undefined) {
                astrologer[field] = body[field];
            }
        });

        // Also hash password if provided
        if (body.password && typeof body.password === "string" && body.password.trim()) {
            const bcrypt = require("bcrypt");
            astrologer.password = await bcrypt.hash(body.password.trim(), 10);
        }

        await astrologer.save();

        // Also update/sync local AstrologerLogin record
        if (astrologer.email) {
            try {
                await AstrologerLogin.findOneAndUpdate(
                    { email: astrologer.email.toLowerCase() },
                    {
                        name: astrologer.name,
                        email: astrologer.email.toLowerCase(),
                        phone: astrologer.phone,
                        password: astrologer.password
                    },
                    { upsert: true }
                );
            } catch (e) {}
        }

        const updated = await Astrologer.findById(req.params.id)
            .populate("user", "name phone email")
            .populate("astrologerLogin");

        return res.status(200).json({
            success: true,
            message: "Astrologer profile updated successfully",
            data: updated
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE astrologer
const deleteAstrologer = async (req, res) => {
    try {
        const id = req.params.id;
        const astrologer = await Astrologer.findById(id);
        if (!astrologer) {
            return res.status(404).json({ success: false, message: "Astrologer not found" });
        }

        // Clean up legacy AstrologerLogin if it exists
        if (astrologer.email) {
            await AstrologerLogin.deleteOne({ email: astrologer.email.toLowerCase() });
        }

        await Astrologer.findByIdAndDelete(id);

        return res.status(200).json({
            success: true,
            message: "Astrologer profile deleted successfully"
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    registerAdmin,
    loginAdmin,
    getProfile,
    getAstrologers,
    getAstrologerById,
    updateAstrologer,
    deleteAstrologer
};
