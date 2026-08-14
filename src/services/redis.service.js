const { getRedisClient } = require("../config/redis");

const getCache = async (key) => {
    try {
        const client = getRedisClient();
        if (client && client.isOpen) {
            return await client.get(key);
        }
    } catch (err) {
        console.error(`Redis get error for key ${key}:`, err.message);
    }
    return null;
};

const setCache = async (key, value, ttlSeconds = 300) => {
    try {
        const client = getRedisClient();
        if (client && client.isOpen) {
            await client.set(key, value, {
                EX: ttlSeconds
            });
        }
    } catch (err) {
        console.error(`Redis set error for key ${key}:`, err.message);
    }
};

const deleteCache = async (key) => {
    try {
        const client = getRedisClient();
        if (client && client.isOpen) {
            await client.del(key);
        }
    } catch (err) {
        console.error(`Redis del error for key ${key}:`, err.message);
    }
};

module.exports = {
    getCache,
    setCache,
    deleteCache
};
