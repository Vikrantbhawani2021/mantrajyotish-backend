const { createClient } = require("redis");

let redisClient = null;

const initRedis = async () => {
    try {
        const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
        console.log(`🔌 Connecting to Redis at: ${redisUrl}`);
        redisClient = createClient({
            url: redisUrl
        });

        redisClient.on("error", (err) => {
            console.error("Redis Client Error:", err.message);
        });

        await redisClient.connect();
        console.log("🚀 Connected to Redis successfully");
        return redisClient;
    } catch (err) {
        console.error("⚠️ Failed to connect to Redis:", err.message);
        console.log("⚠️ Continuing startup: Application will fallback to MongoDB directly.");
        redisClient = null;
    }
};

const getRedisClient = () => {
    return redisClient;
};

module.exports = {
    initRedis,
    getRedisClient
};
