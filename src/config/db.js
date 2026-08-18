const mongoose = require("mongoose");

let isConnected = false;

const connectDB = async () => {
    if (mongoose.connection.readyState >= 1) {
        return;
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("MongoDB Connected");

        // Clean up legacy non-sparse email_1 and tuloId_1 indexes from users collection
        try {
            const usersCol = mongoose.connection.collection("users");
            const userIndexes = await usersCol.indexes();

            const emailIdx = userIndexes.find(idx => idx.name === "email_1");
            if (emailIdx && !emailIdx.sparse) {
                await usersCol.dropIndex("email_1");
                console.log("Successfully dropped legacy non-sparse email_1 index");
            }

            // Clean up legacy unique appointment_1 index from videosessions collection
            try {
                const videoSessionsCol = mongoose.connection.collection("videosessions");
                const videoIndexes = await videoSessionsCol.indexes();
                const apptIdx = videoIndexes.find(idx => idx.name === "appointment_1");
                if (apptIdx) {
                    await videoSessionsCol.dropIndex("appointment_1");
                    console.log("Successfully dropped legacy unique appointment_1 index from videosessions");
                }
            } catch (vErr) {
                console.warn("VideoSessions index drop warning:", vErr.message);
            }

            // Clean up legacy unique appointment_1 index from payments collection
            try {
                const paymentsCol = mongoose.connection.collection("payments");
                const paymentIndexes = await paymentsCol.indexes();
                const apptIdx = paymentIndexes.find(idx => idx.name === "appointment_1");
                if (apptIdx) {
                    await paymentsCol.dropIndex("appointment_1");
                    console.log("Successfully dropped legacy unique appointment_1 index from payments");
                }
            } catch (pErr) {
                console.warn("Payments index drop warning:", pErr.message);
            }

            // Sync User indexes
            const User = require("../models/user.model");
            await User.syncIndexes();
            console.log("User model indexes synced successfully");

            // Migration: Populate uniqueId for existing users
            const usersWithoutId = await User.find({
              $or: [
                { uniqueId: { $exists: false } },
                { uniqueId: null },
                { uniqueId: "" }
              ]
            });
            if (usersWithoutId.length > 0) {
              console.log(`Migrating ${usersWithoutId.length} users to generate uniqueIds...`);
              for (const u of usersWithoutId) {
                let isUnique = false;
                let generatedId = "";
                while (!isUnique) {
                  const randomDigits = Math.floor(100000 + Math.random() * 900000);
                  generatedId = `UB${randomDigits}`;
                  const duplicate = await User.findOne({ uniqueId: generatedId });
                  if (!duplicate) {
                    isUnique = true;
                  }
                }
                u.uniqueId = generatedId;
                await u.save();
              }
              console.log("Migration complete!");
            }
          } catch (err) {
            console.warn("Index sync / Migration warning:", err.message);
          }

    } catch (error) {
        console.error("MongoDB Connection Error:", error);
        throw error;
    }
};

module.exports = connectDB;