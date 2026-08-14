const Astrologer = require("../models/astro.model");
const AstroInterview = require("../models/astroInterview.model");
const { getCache, setCache, deleteCache } = require("./redis.service");

const CACHE_KEY_ONLINE = "online_astrologers";

const clearOnlineAstrologersCache = async () => {
    console.log("🧹 Invalidating online astrologers cache in Redis");
    await deleteCache(CACHE_KEY_ONLINE);
};

const createAstrologer = async (data) => {
    const astrologer = await Astrologer.create(data);
    await clearOnlineAstrologersCache();
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
        .sort({ isOnline: -1, isAvailable: -1, rating: -1, totalConsultations: -1, createdAt: -1 })
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
    const cachedData = await getCache(CACHE_KEY_ONLINE);
    if (cachedData) {
        try {
            console.log("💾 Returning cached online astrologers from Redis");
            return JSON.parse(cachedData);
        } catch (e) {
            console.error("Failed to parse cached online astrologers JSON:", e.message);
        }
    }

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

    const result = astrologers.map(astro => ({
        ...astro,
        interview: interviewMap[String(astro._id)] || null
    }));

    // Cache the online list for 5 minutes (300 seconds)
    await setCache(CACHE_KEY_ONLINE, JSON.stringify(result), 300);

    return result;
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
    const updated = await Astrologer.findByIdAndUpdate(
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
    await clearOnlineAstrologersCache();
    return updated;
};

const rejectAstrologer = async (id) => {
    const updated = await Astrologer.findByIdAndUpdate(
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
    await clearOnlineAstrologersCache();
    return updated;
};

const toggleOnlineStatus = async (id, isOnline, isAvailable) => {
    const updateData = {};
    if (isOnline !== undefined) updateData.isOnline = Boolean(isOnline);
    if (isAvailable !== undefined) updateData.isAvailable = Boolean(isAvailable);

    const updated = await Astrologer.findByIdAndUpdate(
        id,
        { $set: updateData },
        { returnDocument: 'after' }
    )
    .populate("user")
    .populate("astrologerLogin");
    await clearOnlineAstrologersCache();
    return updated;
};

const updateAstrologer = async (id, data) => {
    const updated = await Astrologer.findByIdAndUpdate(
        id,
        data,
        {
            returnDocument: 'after',
            runValidators: true
        }
    ).populate("user").populate("astrologerLogin");
    await clearOnlineAstrologersCache();
    return updated;
};

const deleteAstrologer = async (id) => {
    const deleted = await Astrologer.findByIdAndDelete(id);
    await clearOnlineAstrologersCache();
    return deleted;
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