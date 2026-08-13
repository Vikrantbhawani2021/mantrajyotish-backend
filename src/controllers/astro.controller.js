const AstrologerLogin = require("../models/astrologerLogin.model");
const Astrologer = require("../models/astro.model");
const astroService = require("../services/astro.service");
const cloudinaryService = require("../services/cloudinary.service");

const normalizeAstroData = async (req) => {
    const body = req.body || {};
    let astrologerLoginId = body.astrologerLogin || body.astrologerLoginId || body.astrologerId || req.headers["astrologer-id"] || req.headers["astrologerloginid"] || null;
    let userId = body.user || body.userId || null;
    let email = body.email || req.headers["email"] || null;

    // If request has JWT user from authMiddleware
    if (req.user) {
        if (req.user.role === "astrologer") {
            astrologerLoginId = astrologerLoginId || req.user.userId;
        } else {
            userId = userId || req.user.userId;
        }
    }

    let name = body.name || body.fullName || body.astrologerName || undefined;
    let phone = body.phone || body.mobileNumber || body.mobile || null;
    let password = body.password || null;

    // Auto-fetch name and email from AstrologerLogin record if ID is provided
    if (astrologerLoginId && (!name || !email)) {
        try {
            const loginInfo = await AstrologerLogin.findById(astrologerLoginId);
            if (loginInfo) {
                name = name || loginInfo.name;
                email = email || loginInfo.email;
            }
        } catch (err) {}
    }

    const payload = {};

    if (astrologerLoginId) payload.astrologerLogin = astrologerLoginId;
    if (userId) payload.user = userId;
    if (name) payload.name = name;
    if (email) payload.email = email.toLowerCase();
    if (phone) payload.phone = phone;

    if (password && typeof password === "string" && password.trim()) {
        const bcrypt = require("bcrypt");
        payload.password = await bcrypt.hash(password.trim(), 10);
    }

    const rawProfileImage = body.profilePhoto || body.profileImage;
    if (rawProfileImage) {
        try {
            payload.profileImage = await cloudinaryService.uploadBase64OrUrl(rawProfileImage, "astro_profiles");
        } catch (e) {
            payload.profileImage = rawProfileImage;
        }
    }

    const rawCertificate = body.certificateFile;
    if (rawCertificate) {
        try {
            payload.certificateFile = await cloudinaryService.uploadBase64OrUrl(rawCertificate, "astro_certificates");
        } catch (e) {
            payload.certificateFile = rawCertificate;
        }
    }

    const introduction = body.introduction || body.about;
    if (introduction) {
        payload.introduction = introduction;
        payload.about = introduction;
    }

    if (body.experience !== undefined && body.experience !== null) payload.experience = String(body.experience);
    if (body.approach !== undefined && body.approach !== null) payload.approach = body.approach;
    if (body.motivation !== undefined && body.motivation !== null) payload.motivation = body.motivation;
    if (body.toolsTechniques !== undefined && body.toolsTechniques !== null) payload.toolsTechniques = body.toolsTechniques;
    if (body.achievements !== undefined && body.achievements !== null) payload.achievements = body.achievements;
    if (body.certificateName !== undefined && body.certificateName !== null) payload.certificateName = body.certificateName;
    if (body.consultationFee !== undefined && body.consultationFee !== null) payload.consultationFee = body.consultationFee;

    if (body.isOnline !== undefined && body.isOnline !== null) payload.isOnline = Boolean(body.isOnline);
    if (body.isAvailable !== undefined && body.isAvailable !== null) payload.isAvailable = Boolean(body.isAvailable);

    const strengths = body.selectedStrengths || body.strengths;
    if (strengths && Array.isArray(strengths) && strengths.length > 0) {
        payload.strengths = strengths;
    }

    const specialization = body.selectedSpecializations || body.specialization;
    if (specialization && Array.isArray(specialization) && specialization.length > 0) {
        payload.specialization = specialization;
    }

    const languages = body.languages;
    if (languages && Array.isArray(languages) && languages.length > 0) {
        payload.languages = languages;
    }

    return payload;
};

const createAstrologer = async (req, res, next) => {
    try {
        const payload = await normalizeAstroData(req);

        let astrologer = null;

        const queryConditions = [];
        if (payload.astrologerLogin) queryConditions.push({ astrologerLogin: payload.astrologerLogin });
        if (payload.email) queryConditions.push({ email: payload.email });

        if (queryConditions.length > 0) {
            const existing = await Astrologer.findOne({ $or: queryConditions });
            if (existing) {
                // If payload does not contain password, preserve existing password
                if (!payload.password && existing.password) {
                    payload.password = existing.password;
                }
                astrologer = await astroService.updateAstrologer(existing._id, payload);
            }
        }

        if (!astrologer) {
            astrologer = await astroService.createAstrologer(payload);
        }

        return res.status(201).json({
            success: true,
            message: "Astrologer Profile Saved Successfully (Pending Admin Approval)",
            data: astrologer
        });

    } catch (error) {
        next(error);
    }
};

const getAllAstrologers = async (req, res, next) => {
    try {
        const filter = {};
        if (req.query.status) {
            filter.status = req.query.status;
        }
        if (req.query.online === "true" || req.query.isOnline === "true") {
            filter.isOnline = true;
        }
        if (req.query.available === "true" || req.query.isAvailable === "true") {
            filter.isAvailable = true;
        }

        const astrologers = await astroService.getAllAstrologers(filter);

        return res.status(200).json({
            success: true,
            count: astrologers.length,
            data: astrologers
        });

    } catch (error) {
        next(error);
    }
};

const getPendingAstrologers = async (req, res, next) => {
    try {
        const astrologers = await astroService.getPendingAstrologers();

        return res.status(200).json({
            success: true,
            count: astrologers.length,
            data: astrologers
        });

    } catch (error) {
        next(error);
    }
};

const getOnlineAstrologers = async (req, res, next) => {
    try {
        const astrologers = await astroService.getOnlineAstrologers();

        return res.status(200).json({
            success: true,
            count: astrologers.length,
            data: astrologers
        });

    } catch (error) {
        next(error);
    }
};

const getAstrologerById = async (req, res, next) => {
    try {
        const astrologer = await astroService.getAstrologerById(req.params.id);

        return res.status(200).json({
            success: true,
            data: astrologer
        });

    } catch (error) {
        next(error);
    }
};

const approveAstrologer = async (req, res, next) => {
    try {
        let id = req.params.id || req.body.id || req.body.astrologerId;
        const email = req.body.email;

        if (!id && email) {
            const astro = await Astrologer.findOne({ email: email.toLowerCase() });
            if (astro) id = astro._id;
        }

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Astrologer ID or Email is required"
            });
        }

        const astrologer = await astroService.approveAstrologer(id);

        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: "Astrologer not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Astrologer registration request APPROVED successfully",
            data: astrologer
        });

    } catch (error) {
        next(error);
    }
};

const rejectAstrologer = async (req, res, next) => {
    try {
        let id = req.params.id || req.body.id || req.body.astrologerId;
        const email = req.body.email;

        if (!id && email) {
            const astro = await Astrologer.findOne({ email: email.toLowerCase() });
            if (astro) id = astro._id;
        }

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Astrologer ID or Email is required"
            });
        }

        const astrologer = await astroService.rejectAstrologer(id);

        if (!astrologer) {
            return res.status(404).json({
                success: false,
                message: "Astrologer not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Astrologer registration request REJECTED",
            data: astrologer
        });

    } catch (error) {
        next(error);
    }
};

const toggleOnlineStatus = async (req, res, next) => {
    try {
        let astrologerId = req.params.id || req.body.id || req.body.astrologerId;
        const email = req.body.email;

        // If email provided
        if (!astrologerId && email) {
            const astroByEmail = await Astrologer.findOne({ email: email.toLowerCase() });
            if (astroByEmail) astrologerId = astroByEmail._id;
        }

        // If logged in via JWT
        if (!astrologerId && req.user) {
            const astro = await Astrologer.findOne({ astrologerLogin: req.user.userId });
            if (astro) astrologerId = astro._id;
        }

        // Fallback: latest astrologer if no ID/email provided
        if (!astrologerId) {
            const lastAstro = await Astrologer.findOne().sort({ createdAt: -1 });
            if (lastAstro) astrologerId = lastAstro._id;
        }

        if (!astrologerId) {
            return res.status(404).json({
                success: false,
                message: "Astrologer not found"
            });
        }

        const currentAstro = await Astrologer.findById(astrologerId);
        if (!currentAstro) {
            return res.status(404).json({
                success: false,
                message: "Astrologer not found"
            });
        }

        let isOnline;
        if (typeof req.body.isOnline === "boolean") {
            isOnline = req.body.isOnline;
        } else if (typeof req.body.isOnline === "string") {
            isOnline = req.body.isOnline.toLowerCase() === "true";
        } else if (req.body.status !== undefined) {
            isOnline = String(req.body.status).toLowerCase() === "online";
        } else {
            // Dynamic Toggle: flip current DB status if no value specified
            isOnline = !currentAstro.isOnline;
        }

        let isAvailable;
        if (typeof req.body.isAvailable === "boolean") {
            isAvailable = req.body.isAvailable;
        } else if (typeof req.body.isAvailable === "string") {
            isAvailable = req.body.isAvailable.toLowerCase() === "true";
        } else {
            isAvailable = isOnline;
        }

        const updatedAstrologer = await astroService.toggleOnlineStatus(
            astrologerId,
            isOnline,
            isAvailable
        );

        return res.status(200).json({
            success: true,
            message: `Astrologer status updated to ${isOnline ? "ONLINE" : "OFFLINE"}`,
            data: updatedAstrologer
        });

    } catch (error) {
        next(error);
    }
};

const updateAstrologer = async (req, res, next) => {
    try {
        const payload = await normalizeAstroData(req);
        const astrologer = await astroService.updateAstrologer(
            req.params.id,
            payload
        );

        return res.status(200).json({
            success: true,
            message: "Astrologer Updated Successfully",
            data: astrologer
        });

    } catch (error) {
        next(error);
    }
};

const deleteAstrologer = async (req, res, next) => {
    try {
        await astroService.deleteAstrologer(req.params.id);

        return res.status(200).json({
            success: true,
            message: "Astrologer Deleted Successfully"
        });

    } catch (error) {
        next(error);
    }
};

module.exports = {
    createAstrologer,
    getAllAstrologers,
    getPendingAstrologers,
    getOnlineAstrologers,
    getAstrologerById,
    approveAstrologer,
    rejectAstrologer,
    toggleOnlineStatus,
    updateAstrologer,
    deleteAstrologer
};