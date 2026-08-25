const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.development") });

const User = require("../src/models/user.model");
const Astrologer = require("../src/models/astro.model");
const { getDefaultProfilePic } = require("../src/services/cloudinary.service");

const backfill = async () => {
    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected successfully!");

        // Helper to check if a profile image is a default fallback picture
        const isDefaultPic = (url) => {
            if (!url) return true;
            return url.includes("res.cloudinary.com") && 
                   (url.includes("user_female_pic") || 
                    url.includes("user_male_pic") || 
                    url.includes("user_profile_pic") ||
                    url.includes("astro_female_pic") || 
                    url.includes("astro_male_pic") || 
                    url.includes("astro_profile_pic"));
        };

        // 1. Backfill Users
        console.log("Fetching users...");
        const users = await User.find({});
        let updatedUsersCount = 0;

        for (const user of users) {
            if (isDefaultPic(user.profileImage)) {
                const newPic = getDefaultProfilePic(user._id, user.role, user.gender);
                if (user.profileImage !== newPic) {
                    user.profileImage = newPic;
                    await user.save();
                    updatedUsersCount++;
                }
            }
        }
        console.log(`Updated ${updatedUsersCount} users default profile pictures.`);

        // 2. Backfill Astrologers
        console.log("Fetching astrologers...");
        const astros = await Astrologer.find({});
        let updatedAstrosCount = 0;

        for (const astro of astros) {
            if (isDefaultPic(astro.profileImage)) {
                const newPic = getDefaultProfilePic(astro._id, "astrologer", astro.gender);
                if (astro.profileImage !== newPic) {
                    astro.profileImage = newPic;
                    await astro.save();
                    updatedAstrosCount++;
                }
            }
        }
        console.log(`Updated ${updatedAstrosCount} astrologers default profile pictures.`);

        console.log("Backfill operation completed successfully!");
        process.exit(0);
    } catch (error) {
        console.error("Backfill operation failed:", error);
        process.exit(1);
    }
};

backfill();
