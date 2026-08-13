const AstroInterview = require("../models/astroInterview.model");
const Astrologer = require("../models/astro.model");
const AstrologerLogin = require("../models/astrologerLogin.model");
const agoraService = require("./agora.service");
const mongoose = require("mongoose");

const isValidObjectId = (id) => {
    if (!id) return false;
    if (typeof id === "object" && mongoose.Types.ObjectId.isValid(id)) return true;
    const str = String(id);
    return mongoose.Types.ObjectId.isValid(str) && str.length === 24;
};

/**
 * Astrologer Requests an Interview
 */
const requestInterview = async (astrologerIdOrEmail, requestNotes = "", preferredSlots = []) => {
    let astrologer = null;

    if (astrologerIdOrEmail && typeof astrologerIdOrEmail === "string" && astrologerIdOrEmail.includes("@")) {
        astrologer = await Astrologer.findOne({ email: astrologerIdOrEmail.toLowerCase() });
    } else if (astrologerIdOrEmail && isValidObjectId(astrologerIdOrEmail)) {
        astrologer = await Astrologer.findById(astrologerIdOrEmail);
        if (!astrologer) {
            astrologer = await Astrologer.findOne({ astrologerLogin: astrologerIdOrEmail });
        }
    }

    // Try finding by AstrologerLogin if not found yet
    if (!astrologer && astrologerIdOrEmail) {
        let loginInfo = null;
        if (isValidObjectId(astrologerIdOrEmail)) {
            loginInfo = await AstrologerLogin.findById(astrologerIdOrEmail);
        } else if (typeof astrologerIdOrEmail === "string" && astrologerIdOrEmail.includes("@")) {
            loginInfo = await AstrologerLogin.findOne({ email: astrologerIdOrEmail.toLowerCase() });
        }
        if (loginInfo) {
            // Auto-create Astrologer profile for this login
            astrologer = await Astrologer.create({
                astrologerLogin: loginInfo._id,
                name: loginInfo.name || "New Astrologer",
                email: loginInfo.email,
                status: "pending",
                isVerified: false
            });
        }
    }

    if (!astrologer && !astrologerIdOrEmail) {
        // Fallback only if no identifier was passed
        astrologer = await Astrologer.findOne().sort({ createdAt: -1 });
    }

    if (!astrologer) {
        throw new Error("Astrologer account not found for interview request");
    }

    // Check if an interview record already exists for this astrologer
    let interview = await AstroInterview.findOne({ astrologer: astrologer._id });

    if (interview) {
        interview.status = "requested";
        interview.result = "pending";
        interview.requestNotes = requestNotes || interview.requestNotes;
        if (Array.isArray(preferredSlots) && preferredSlots.length > 0) {
            interview.preferredSlots = preferredSlots;
        }
        await interview.save();
    } else {
        interview = await AstroInterview.create({
            astrologer: astrologer._id,
            status: "requested",
            result: "pending",
            requestNotes,
            preferredSlots
        });
    }

    return await AstroInterview.findById(interview._id).populate("astrologer");
};

/**
 * Admin Schedules Interview with Date, Time, and Agora Channel/Token Setup
 */
const scheduleInterview = async (identifier, interviewDate, meetingLink, interviewerNotes = "") => {
    let interview = null;

    // Try finding by interview ID
    if (identifier && isValidObjectId(identifier)) {
        try {
            interview = await AstroInterview.findById(identifier);
        } catch (e) {}
    }

    // Try finding by astrologer ID or Email
    if (!interview && identifier) {
        let astrologerId = null;
        if (typeof identifier === "string" && identifier.includes("@")) {
            const astro = await Astrologer.findOne({ email: identifier.toLowerCase() });
            if (astro) astrologerId = astro._id;
        } else if (isValidObjectId(identifier)) {
            astrologerId = identifier;
        }

        if (astrologerId) {
            interview = await AstroInterview.findOne({ astrologer: astrologerId });

            // If no interview record exists yet, create one
            if (!interview) {
                interview = await AstroInterview.create({
                    astrologer: astrologerId,
                    status: "requested"
                });
            }
        }
    }

    if (!interview) {
        // Fallback to latest requested interview
        interview = await AstroInterview.findOne({ status: "requested" }).sort({ createdAt: -1 });
    }

    if (!interview) {
        throw new Error("No pending interview request found to schedule");
    }

    if (!interviewDate) {
        throw new Error("interviewDate is required for scheduling");
    }

    // Generate Agora channel name and tokens
    const now = Date.now();
    const astrologerIdStr = String(interview.astrologer);
    const channelName = `interview_${astrologerIdStr.substring(18)}_${now}`;

    // Token expires in 2 hours
    const tokenExpireTime = 7200;

    // Admin RTC token (UID 1)
    const adminTokenData = agoraService.generateRtcToken(channelName, 1, "publisher", tokenExpireTime);
    // Astrologer RTC token (UID 2)
    const astrologerTokenData = agoraService.generateRtcToken(channelName, 2, "publisher", tokenExpireTime);

    interview.interviewDate = new Date(interviewDate);
    // Custom Agora Web Interview Link (fallback default is set, but frontends will override with Agora UI)
    interview.meetingLink = meetingLink || `https://astrologer-interview.digitalinapp.com/room/${channelName}`;
    interview.status = "scheduled";
    interview.scheduledAt = new Date();
    
    // Set Agora Specific fields
    interview.agoraChannel = channelName;
    interview.agoraAdminToken = adminTokenData.token;
    interview.agoraAstrologerToken = astrologerTokenData.token;
    interview.agoraAdminUid = 1;
    interview.agoraAstrologerUid = 2;

    if (interviewerNotes) interview.interviewerNotes = interviewerNotes;

    await interview.save();

    return await AstroInterview.findById(interview._id).populate("astrologer");
};

/**
 * Admin Evaluates Interview Result (Pass or Fail)
 */
const evaluateInterview = async (identifier, result, interviewerNotes = "") => {
    const evalResult = String(result).toLowerCase();
    if (!["pass", "fail", "passed", "failed"].includes(evalResult)) {
        throw new Error("Result must be either 'pass' or 'fail'");
    }

    const isPass = evalResult === "pass" || evalResult === "passed";

    let interview = null;
    if (identifier && isValidObjectId(identifier)) {
        try {
            interview = await AstroInterview.findById(identifier);
        } catch (e) {}
    }

    if (!interview && identifier) {
        let astrologerId = null;
        if (typeof identifier === "string" && identifier.includes("@")) {
            const astro = await Astrologer.findOne({ email: identifier.toLowerCase() });
            if (astro) astrologerId = astro._id;
        } else if (isValidObjectId(identifier)) {
            astrologerId = identifier;
        }

        if (astrologerId) {
            interview = await AstroInterview.findOne({ astrologer: astrologerId });
        }
    }

    if (!interview) {
        interview = await AstroInterview.findOne().sort({ updatedAt: -1 });
    }

    if (!interview) {
        throw new Error("Interview session not found for evaluation");
    }

    interview.result = isPass ? "pass" : "fail";
    interview.status = isPass ? "passed" : "failed";
    interview.completedAt = new Date();
    if (interviewerNotes) interview.interviewerNotes = interviewerNotes;

    await interview.save();

    // Automatically update Astrologer Status in DB
    if (interview.astrologer) {
        const astroStatus = isPass ? "approved" : "rejected";
        await Astrologer.findByIdAndUpdate(interview.astrologer, {
            status: astroStatus,
            isVerified: isPass
        });
    }

    return await AstroInterview.findById(interview._id).populate("astrologer");
};

/**
 * Mark Interview Completed (Without immediate Pass/Fail decision)
 */
const completeInterview = async (identifier, interviewerNotes = "") => {
    let interview = null;
    if (identifier && isValidObjectId(identifier)) {
        try {
            interview = await AstroInterview.findById(identifier);
        } catch (e) {}
    }

    if (!interview && identifier) {
        let astrologerId = null;
        if (typeof identifier === "string" && identifier.includes("@")) {
            const astro = await Astrologer.findOne({ email: identifier.toLowerCase() });
            if (astro) astrologerId = astro._id;
        } else if (isValidObjectId(identifier)) {
            astrologerId = identifier;
        }

        if (astrologerId) {
            interview = await AstroInterview.findOne({ astrologer: astrologerId });
        }
    }

    if (!interview) {
        interview = await AstroInterview.findOne({ status: "scheduled" }).sort({ updatedAt: -1 });
    }

    if (!interview) {
        throw new Error("No scheduled interview session found to complete");
    }

    interview.status = "completed";
    interview.completedAt = new Date();
    if (interviewerNotes) interview.interviewerNotes = interviewerNotes;

    await interview.save();

    return await AstroInterview.findById(interview._id).populate("astrologer");
};

/**
 * Update Interviewer Notes for an Interview
 */
const updateInterviewNotes = async (identifier, interviewerNotes = "") => {
    let interview = null;
    if (identifier && isValidObjectId(identifier)) {
        try {
            interview = await AstroInterview.findById(identifier);
        } catch (e) {}
    }

    if (!interview && identifier) {
        let astrologerId = null;
        if (typeof identifier === "string" && identifier.includes("@")) {
            const astro = await Astrologer.findOne({ email: identifier.toLowerCase() });
            if (astro) astrologerId = astro._id;
        } else if (isValidObjectId(identifier)) {
            astrologerId = identifier;
        }

        if (astrologerId) {
            interview = await AstroInterview.findOne({ astrologer: astrologerId });
        }
    }

    if (!interview) {
        interview = await AstroInterview.findOne().sort({ updatedAt: -1 });
    }

    if (!interview) {
        throw new Error("Interview record not found to save notes");
    }

    interview.interviewerNotes = interviewerNotes;
    await interview.save();

    return await AstroInterview.findById(interview._id).populate("astrologer");
};

/**
 * Get All Interviews for Admin
 */
const getAllInterviews = async (filter = {}) => {
    return await AstroInterview.find(filter)
        .populate("astrologer")
        .sort({ createdAt: -1 });
};

/**
 * Get Interview Details for a Specific Astrologer
 */
const getAstrologerInterview = async (astrologerIdOrEmail) => {
    let astrologerId = astrologerIdOrEmail;
    if (astrologerIdOrEmail && astrologerIdOrEmail.includes("@")) {
        const astro = await Astrologer.findOne({ email: astrologerIdOrEmail.toLowerCase() });
        if (astro) astrologerId = astro._id;
    }

    return await AstroInterview.findOne({ astrologer: astrologerId })
        .populate("astrologer")
        .sort({ createdAt: -1 });
};

module.exports = {
    requestInterview,
    scheduleInterview,
    evaluateInterview,
    completeInterview,
    updateInterviewNotes,
    getAllInterviews,
    getAstrologerInterview
};
