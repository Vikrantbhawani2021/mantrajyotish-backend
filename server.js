const dns = require("dns");
try {
    dns.setDefaultResultOrder("ipv4first");
} catch (e) {}

require("dotenv").config();
require("./src/config/config");

const http = require("http");
const app = require("./src/app");
const connectDB = require("./src/config/db");
const { initSocket } = require("./src/config/socket");

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
initSocket(server);

const startServer = async () => {
    try {
        server.listen(PORT, () => {
            console.log(`🚀 Server Running on Port ${PORT} with Socket.io Enabled`);
        });

        connectDB().catch(err => {
            console.error("MongoDB connection warning:", err.message);
        });

    } catch (error) {
        console.log(error);
        process.exit(1);
    }
};

startServer();