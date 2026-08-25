const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

// Load environmental variables
dotenv.config();

const { getDefaultProfilePic } = require("../src/services/cloudinary.service");
const User = require("../src/models/user.model");
const Astrologer = require("../src/models/astro.model");

const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
    console.error("MONGO_URI is not set in .env!");
    process.exit(1);
}

function isDefaultPic(url) {
    if (!url) return true;
    
    // Check if it matches Cloudinary default templates
    if (url.includes("res.cloudinary.com")) {
        const defaults = [
            "user_female_pic",
            "user_male_pic",
            "user_profile_pic",
            "astro_female_pic",
            "astro_male_pic",
            "astro_profile_pic",
            "sample.jpg"
        ];
        return defaults.some(pattern => url.includes(pattern));
    }
    
    return false;
}

async function runMigration() {
    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(mongoUri);
        console.log("Connected successfully!");

        console.log("\n--- Migrating Users ---");
        const users = await User.find({});
        console.log(`Found ${users.length} users in database.`);
        
        let userUpdateCount = 0;
        for (const user of users) {
            const currentDp = user.profileImage;
            if (isDefaultPic(currentDp)) {
                // Calculate new default DP based on updated illustration count
                const newDp = getDefaultProfilePic(user._id, user.role, user.gender);
                if (currentDp !== newDp) {
                    user.profileImage = newDp;
                    await user.save();
                    userUpdateCount++;
                    console.log(`Updated User [ID: ${user._id}, Name: ${user.firstname || ""} ${user.lastname || ""}] to: ${newDp}`);
                }
            }
        }
        console.log(`Finished Users. Updated ${userUpdateCount} users.`);

        console.log("\n--- Migrating Astrologers ---");
        const astrologers = await Astrologer.find({});
        console.log(`Found ${astrologers.length} astrologers in database.`);

        let astroUpdateCount = 0;
        for (const astro of astrologers) {
            const currentDp = astro.profileImage;
            if (isDefaultPic(currentDp)) {
                // Calculate new default DP based on updated illustration count
                const newDp = getDefaultProfilePic(astro._id, "astrologer", astro.gender);
                if (currentDp !== newDp) {
                    astro.profileImage = newDp;
                    await astro.save();
                    astroUpdateCount++;
                    console.log(`Updated Astrologer [ID: ${astro._id}, Name: ${astro.name || ""}] to: ${newDp}`);
                }
            }
        }
        console.log(`Finished Astrologers. Updated ${astroUpdateCount} astrologers.`);

        console.log("\nMigration completed successfully!");
    } catch (err) {
        console.error("Migration failed with error:", err);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB.");
    }
}

runMigration();
