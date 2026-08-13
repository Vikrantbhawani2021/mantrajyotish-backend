const mongoose = require("mongoose");

const AstroInterviewSchema = new mongoose.Schema(
    {
        astrologer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Astrologer",
            required: true
        },

        status: {
            type: String,
            enum: ["requested", "scheduled", "completed", "passed", "failed", "cancelled"],
            default: "requested"
        },

        result: {
            type: String,
            enum: ["pending", "pass", "fail"],
            default: "pending"
        },

        interviewDate: {
            type: Date,
            default: null
        },

        meetingLink: {
            type: String,
            default: null,
            trim: true
        },

        requestNotes: {
            type: String,
            default: null,
            trim: true
        },

        preferredSlots: [
            {
                date: { type: String, default: null },
                time: { type: String, default: null }
            }
        ],

        interviewerNotes: {
            type: String,
            default: null,
            trim: true
        },

        scheduledAt: {
            type: Date,
            default: null
        },

        completedAt: {
            type: Date,
            default: null
        },

        // ─── Agora RTC Fields for Video Interview ─────────────────────────
        agoraChannel: {
            type: String,
            default: null,
            trim: true
        },

        // Pre-generated Agora token for the admin (UID: 1)
        agoraAdminToken: {
            type: String,
            default: null
        },

        // Pre-generated Agora token for the astrologer (UID: 2)
        agoraAstrologerToken: {
            type: String,
            default: null
        },

        // Numeric UIDs assigned in the Agora channel
        agoraAdminUid: {
            type: Number,
            default: 1
        },

        agoraAstrologerUid: {
            type: Number,
            default: 2
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("AstroInterview", AstroInterviewSchema);
