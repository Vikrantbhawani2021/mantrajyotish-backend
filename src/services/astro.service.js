const Astrologer = require("../models/astro.model");
const AstroInterview = require("../models/astroInterview.model");

const createAstrologer = async (data) => {
    const astrologer = await Astrologer.create(data);
    return await Astrologer.findById(astrologer._id)
        .populate("user")
        .populate("astrologerLogin");
};

const getAllAstrologers = async (filter = {}) => {
    // Default to status: "approved" for public listing unless custom status filter is requested
    const query = { ...filter };
    if (!query.status && query.status !== "all") {
        query.status = "approved";
    } else if (query.status === "all") {
        delete query.status;
    }

    const astrologers = await Astrologer.find(query)
        .sort({ createdAt: -1 })
        .populate("user")
        .populate("astrologerLogin")
        .lean();

    // Batch fetch all interviews in ONE query instead of N queries
    const astroIds = astrologers.map(a => a._id);
    const interviews = await AstroInterview.find({ astrologer: { $in: astroIds } }).lean();
    const interviewMap = {};
    for (const iv of interviews) {
        interviewMap[String(iv.astrologer)] = iv;
    }

    return astrologers.map(astro => ({
        ...astro,
        interview: interviewMap[String(astro._id)] || null
    }));
};

const getPendingAstrologers = async () => {
    const astrologers = await Astrologer.find({
        $or: [
            { status: "pending" },
            { status: { $exists: false } },
            { status: null }
        ],
        isVerified: { $ne: true }
    })
        .sort({ createdAt: -1 })
        .populate("user")
        .populate("astrologerLogin")
        .lean();

    // Batch fetch all interviews in ONE query instead of N queries
    const astroIds = astrologers.map(a => a._id);
    const interviews = await AstroInterview.find({ astrologer: { $in: astroIds } }).lean();
    const interviewMap = {};
    for (const iv of interviews) {
        interviewMap[String(iv.astrologer)] = iv;
    }

    return astrologers.map(astro => ({
        ...astro,
        interview: interviewMap[String(astro._id)] || null
    }));
};

const getOnlineAstrologers = async () => {
    const astrologers = await Astrologer.find({
        status: "approved",
        $or: [
            { isOnline: true },
            { isAvailable: true }
        ]
    })
    .populate("user")
    .populate("astrologerLogin")
    .lean();

    // Batch fetch all interviews in ONE query instead of N queries
    const astroIds = astrologers.map(a => a._id);
    const interviews = await AstroInterview.find({ astrologer: { $in: astroIds } }).lean();
    const interviewMap = {};
    for (const iv of interviews) {
        interviewMap[String(iv.astrologer)] = iv;
    }

    return astrologers.map(astro => ({
        ...astro,
        interview: interviewMap[String(astro._id)] || null
    }));
};

const getAstrologerById = async (id) => {
    const astro = await Astrologer.findById(id)
        .populate("user")
        .populate("astrologerLogin");
    if (!astro) return null;
    const interview = await AstroInterview.findOne({ astrologer: astro._id });
    const astroObj = astro.toObject();
    astroObj.interview = interview || null;
    return astroObj;
};

const approveAstrologer = async (id) => {
    return await Astrologer.findByIdAndUpdate(
        id,
        {
            $set: {
                status: "approved",
                isVerified: true
            }
        },
        { returnDocument: 'after' }
    )
    .populate("user")
    .populate("astrologerLogin");
};

const rejectAstrologer = async (id) => {
    return await Astrologer.findByIdAndUpdate(
        id,
        {
            $set: {
                status: "rejected",
                isOnline: false,
                isAvailable: false
            }
        },
        { returnDocument: 'after' }
    )
    .populate("user")
    .populate("astrologerLogin");
};

const toggleOnlineStatus = async (id, isOnline, isAvailable) => {
    const updateData = {};
    if (isOnline !== undefined) updateData.isOnline = Boolean(isOnline);
    if (isAvailable !== undefined) updateData.isAvailable = Boolean(isAvailable);

    return await Astrologer.findByIdAndUpdate(
        id,
        { $set: updateData },
        { returnDocument: 'after' }
    )
    .populate("user")
    .populate("astrologerLogin");
};

const updateAstrologer = async (id, data) => {
    return await Astrologer.findByIdAndUpdate(
        id,
        data,
        {
            returnDocument: 'after',
            runValidators: true
        }
    ).populate("user").populate("astrologerLogin");
};

const deleteAstrologer = async (id) => {
    return await Astrologer.findByIdAndDelete(id);
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