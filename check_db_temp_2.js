const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const mongoUri = process.env.MONGO_URI;

mongoose.connect(mongoUri)
    .then(async () => {
        const AstroInterview = mongoose.model("AstroInterview", new mongoose.Schema({
            astrologer: { type: mongoose.Schema.Types.ObjectId, ref: "Astrologer" }
        }, { strict: false }), "astrointerviews");
        
        const Astrologer = mongoose.model("Astrologer", new mongoose.Schema({}, { strict: false }), "astrologers");

        const interviews = await AstroInterview.find({});
        for (const i of interviews) {
            console.log("Interview ID:", i._id, "Astro ID in Interview:", i.astrologer);
            const astro = await Astrologer.findById(i.astrologer);
            console.log("Found Astro in DB?", !!astro, astro ? astro.name : null, astro ? astro.email : null);
        }
        
        mongoose.disconnect();
    })
    .catch(err => {
        console.error(err);
    });
