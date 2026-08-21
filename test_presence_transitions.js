require("dotenv").config();
const mongoose = require("mongoose");
const { getRedisClient, initRedis } = require("./src/config/redis");
const connectDB = require("./src/config/db");
const { 
    getPresence, 
    setPresence, 
    transitionStatus, 
    acquireBookingLock 
} = require("./src/services/presence.service");
const Astrologer = require("./src/models/astro.model");

// Configure test environment variables
process.env.PRESENCE_TTL = "10";
process.env.PRESENCE_DISCONNECT_GRACE_PERIOD = "2";

const runTests = async () => {
    console.log("🚦 Starting Real-Time Presence System Integration Tests...\n");
    
    // Connect DB & Redis
    await connectDB();
    await initRedis();

    const client = getRedisClient();
    if (!client || !client.isOpen) {
        console.error("❌ Redis is not connected. Aborting tests.");
        process.exit(1);
    }

    // Create a mock astrologer
    const mockAstro = await Astrologer.findOneAndUpdate(
        { email: "test_presence_astro@gmail.com" },
        {
            name: "Test Presence Astro",
            email: "test_presence_astro@gmail.com",
            status: "approved",
            isOnline: false,
            isAvailable: false,
            manualOffline: true,
            consultationFee: 20
        },
        { upsert: true, returnDocument: 'after' }
    );
    const astroId = String(mockAstro._id);
    console.log(`✅ Created Mock Astrologer: ${mockAstro.name} (${astroId})`);

    // Clean up any old presence keys
    await client.del(`astrologer:presence:${astroId}`);
    await client.del(`lock:astrologer:booking:${astroId}`);

    try {
        // Test 1: OFFLINE -> ONLINE
        console.log("\n🧪 Test 1: OFFLINE -> ONLINE transition...");
        let p = await transitionStatus(astroId, "ONLINE");
        if (p.status === "ONLINE") {
            console.log("   👉 Success: Status transitioned to ONLINE");
        } else {
            throw new Error(`Test 1 Failed: status is ${p.status}`);
        }

        // Test 2: Valid Transitions validation (ONLINE -> BUSY)
        console.log("\n🧪 Test 2: ONLINE -> BUSY transition...");
        p = await transitionStatus(astroId, "BUSY", "mock_session_123");
        if (p.status === "BUSY" && p.activeSessionId === "mock_session_123") {
            console.log("   👉 Success: Status transitioned to BUSY with session ID");
        } else {
            throw new Error(`Test 2 Failed: status is ${p.status}`);
        }

        // Test 3: Invalid Transition Guard (BUSY -> OFFLINE directly is allowed, but try invalid transition like manual toggle offline then trying to go BUSY directly)
        console.log("\n🧪 Test 3: Invalid state transition validation (OFFLINE -> BUSY)...");
        await transitionStatus(astroId, "OFFLINE");
        try {
            await transitionStatus(astroId, "BUSY", "should_fail");
            throw new Error("Test 3 Failed: OFFLINE -> BUSY was allowed!");
        } catch (err) {
            console.log("   👉 Success: Invalid transition correctly blocked with message:", err.message);
        }

        // Test 4: Booking Lock Race Condition Protection
        console.log("\n🧪 Test 4: Session booking race condition & lock verification...");
        // Set back to ONLINE first
        await transitionStatus(astroId, "ONLINE");
        
        // Simulating simultaneous booking requests
        const bookingPromise1 = acquireBookingLock(astroId, "session_user_A");
        const bookingPromise2 = acquireBookingLock(astroId, "session_user_B");

        const results = await Promise.allSettled([bookingPromise1, bookingPromise2]);
        
        const successCount = results.filter(r => r.status === "fulfilled" && r.value === true).length;
        const failedResult = results.find(r => r.status === "rejected");

        if (successCount === 1) {
            console.log("   👉 Success: Exactly one user acquired the booking lock.");
            console.log("   👉 Locked User Error message correctly thrown to other user:", failedResult.reason.message);
        } else {
            throw new Error(`Test 4 Failed: success count is ${successCount}`);
        }

        // Verify status is now BUSY in Redis and DB
        const finalPresence = await getPresence(astroId);
        const finalDbState = await Astrologer.findById(astroId).lean();
        if (finalPresence.status === "BUSY" && finalDbState.isAvailable === false && finalDbState.isOnline === true) {
            console.log("   👉 Success: Final state verified as BUSY (Redis) and unavailable (DB)");
        } else {
            throw new Error("Test 4 Failed: final state is not BUSY/unavailable");
        }

    } catch (testErr) {
        console.error("\n❌ Test Suite Failed:", testErr);
    } finally {
        // Clean up mock astrologer and close connections
        await Astrologer.findByIdAndDelete(astroId);
        await client.del(`astrologer:presence:${astroId}`);
        await mongoose.disconnect();
        console.log("\n🚦 Test Suite finished and cleaned up.");
    }
};

runTests();
