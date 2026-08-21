const mongoose = require("mongoose");

const AstroSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: false,
            default: null
        },

        astrologerLogin: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AstrologerLogin",
            required: false,
            default: null
        },

        name: {
            type: String,
            default: null,
            trim: true
        },

        email: {
            type: String,
            default: null,
            trim: true,
            lowercase: true,
            unique: true,
            sparse: true
        },

        password: {
            type: String,
            default: null
        },

        profileImage: {
            type: String,
            default: null
        },

        introduction: {
            type: String,
            trim: true,
            default: null
        },

        about: {
            type: String,
            trim: true,
            default: null
        },

        experience: {
            type: String,
            default: "0"
        },

        strengths: {
            type: [String],
            default: []
        },

        approach: {
            type: String,
            trim: true,
            default: null
        },

        motivation: {
            type: String,
            trim: true,
            default: null
        },

        languages: {
            type: [String],
            default: []
        },

        specialization: {
            type: [String],
            default: []
        },

        toolsTechniques: {
            type: String,
            trim: true,
            default: null
        },

        certificateFile: {
            type: String,
            default: null
        },

        certificateName: {
            type: String,
            default: null
        },

        achievements: {
            type: String,
            trim: true,
            default: null
        },

        consultationFee: {
            type: Number,
            default: 0,
            min: 0
        },

        consultationMode: {
            type: [String],
            enum: ["chat", "call", "video"],
            default: ["chat"]
        },

        rating: {
            type: Number,
            default: 0,
            min: 0,
            max: 5
        },

        totalReviews: {
            type: Number,
            default: 0,
            min: 0
        },

        totalConsultations: {
            type: Number,
            default: 0,
            min: 0
        },

        averageResponseTime: {
            type: Number,
            default: 0,
            min: 0
        },

        walletBalance: {
            type: Number,
            default: 0,
            min: 0
        },

        isVerified: {
            type: Boolean,
            default: false
        },

        isOnline: {
            type: Boolean,
            default: false
        },

        manualOffline: {
            type: Boolean,
            default: true
        },

        isAvailable: {
            type: Boolean,
            default: true
        },

        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending"
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("Astrologer", AstroSchema);